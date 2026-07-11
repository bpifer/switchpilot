import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { siteFilter } from './util.js';
import { requireRole } from '../auth/rbac.js';
import { config } from '../config.js';

export default async function poeRoutes(app: FastifyInstance) {
  app.get('/api/poe/summary', {
    preHandler: requireRole('readonly'),
    schema: { querystring: { type: 'object', properties: { siteId: { type: 'string' } } } }
  }, async (req) => {
    const sf = siteFilter((req.query as any).siteId, 'd');
    const siteCond = sf.cond ? `AND ${sf.cond}` : '';

    // Per-device: latest PoE metrics from device_metrics time series
    const { rows: devices } = await query(`
      SELECT
        d.id AS device_id,
        d.hostname,
        host(d.mgmt_ip) AS mgmt_ip,
        d.status,
        COALESCE(s.name, 'Unassigned') AS site_name,
        dm.poe_watts_used::float     AS poe_watts_used,
        dm.poe_watts_capacity::float AS poe_watts_capacity,
        CASE WHEN dm.poe_watts_capacity > 0
          THEN round((dm.poe_watts_used / dm.poe_watts_capacity * 100)::numeric, 1)::float
          ELSE NULL
        END AS poe_pct
      FROM devices d
      LEFT JOIN sites s ON s.id = d.site_id
      LEFT JOIN LATERAL (
        SELECT poe_watts_used, poe_watts_capacity
        FROM device_metrics
        WHERE device_id = d.id
          AND poe_watts_capacity IS NOT NULL
          AND poe_watts_capacity > 0
        ORDER BY ts DESC
        LIMIT 1
      ) dm ON true
      WHERE dm.poe_watts_capacity IS NOT NULL ${siteCond}
      ORDER BY poe_pct DESC NULLS LAST, d.hostname
    `, sf.params);

    // Per-site rollup
    const { rows: sites } = await query(`
      SELECT
        COALESCE(s.name, 'Unassigned') AS site_name,
        count(d.id)::int                AS switch_count,
        sum(dm.poe_watts_used)::float   AS poe_watts_used,
        sum(dm.poe_watts_capacity)::float AS poe_watts_capacity,
        CASE WHEN sum(dm.poe_watts_capacity) > 0
          THEN round((sum(dm.poe_watts_used) / sum(dm.poe_watts_capacity) * 100)::numeric, 1)::float
          ELSE NULL
        END AS poe_pct
      FROM devices d
      LEFT JOIN sites s ON s.id = d.site_id
      LEFT JOIN LATERAL (
        SELECT poe_watts_used, poe_watts_capacity
        FROM device_metrics
        WHERE device_id = d.id
          AND poe_watts_capacity IS NOT NULL
          AND poe_watts_capacity > 0
        ORDER BY ts DESC
        LIMIT 1
      ) dm ON true
      WHERE dm.poe_watts_capacity IS NOT NULL ${siteCond}
      GROUP BY s.name
      ORDER BY poe_pct DESC NULLS LAST
    `, sf.params);

    return { devices, sites };
  });

  // PoE energy + estimated cost over a window, from the poe_watts_used series.
  app.get<{ Querystring: { range?: string; siteId?: string } }>('/api/poe/energy', {
    preHandler: requireRole('readonly'),
    schema: {
      tags: ['poe'],
      querystring: { type: 'object', properties: { range: { type: 'string' }, siteId: { type: 'string' } } },
      response: { 200: {
        type: 'object', additionalProperties: true,
        properties: {
          range: { type: 'string' }, hours: { type: 'integer' }, rate: { type: 'number' },
          devices: { type: 'array', items: { type: 'object', additionalProperties: true } },
          total: { type: 'object', additionalProperties: true },
        },
      } },
    }
  }, async (req) => {
    const range = req.query.range ?? '7d';
    const hours = range === '24h' ? 24 : range === '30d' ? 720 : 168;   // default 7d
    const sf = siteFilter(req.query.siteId, 'd');
    const siteCond = sf.cond ? `AND ${sf.cond}` : '';
    // Average PoE draw over the window; energy = avg power x hours. The metrics
    // series is sampled (POLL_METRICS_INTERVAL), so this is an estimate.
    const { rows } = await query<{ device_id: string; hostname: string; mgmt_ip: string; site_name: string; avg_watts: number }>(`
      SELECT d.id AS device_id, d.hostname, host(d.mgmt_ip) AS mgmt_ip,
             COALESCE(s.name, 'Unassigned') AS site_name,
             AVG(dm.poe_watts_used)::float AS avg_watts
      FROM devices d
      LEFT JOIN sites s ON s.id = d.site_id
      JOIN device_metrics dm ON dm.device_id = d.id
      WHERE dm.ts > now() - interval '${hours} hours'
        AND dm.poe_watts_used IS NOT NULL AND dm.poe_watts_used > 0 ${siteCond}
      GROUP BY d.id, d.hostname, d.mgmt_ip, s.name
      ORDER BY avg_watts DESC NULLS LAST
    `, sf.params);

    const rate = config.poeRatePerKwh;
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const devices = rows.map(row => {
      const kwh = (row.avg_watts ?? 0) * hours / 1000;
      return {
        device_id: row.device_id, hostname: row.hostname, mgmt_ip: row.mgmt_ip, site_name: row.site_name,
        avg_watts: r2(row.avg_watts ?? 0), kwh: r2(kwh), cost: rate > 0 ? r2(kwh * rate) : null,
      };
    });
    const totalKwh = devices.reduce((s, d) => s + d.kwh, 0);
    return { range, hours, rate, devices, total: { kwh: r2(totalKwh), cost: rate > 0 ? r2(totalKwh * rate) : null } };
  });
}
