import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { siteFilter } from './util.js';

export default async function poeRoutes(app: FastifyInstance) {
  app.get('/api/poe/summary', {
    schema: { querystring: { type: 'object', properties: { siteId: { type: 'string' } } } }
  }, async (req, reply) => {
    try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'Authentication required' }); }
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
}
