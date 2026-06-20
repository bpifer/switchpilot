import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';

// Bucket size + retention per range
function rangeConfig(range: string): { interval: string; bucket: string } {
  switch (range) {
    case '30d': return {
      interval: '30 days',
      bucket: `to_timestamp(floor(extract(epoch from ts) / ${3600 * 6}) * ${3600 * 6})`,
    };
    case '90d': return {
      interval: '90 days',
      bucket: `to_timestamp(floor(extract(epoch from ts) / ${3600 * 12}) * ${3600 * 12})`,
    };
    case '1y': return {
      interval: '1 year',
      bucket: `date_trunc('day', ts)`,
    };
    default: return {  // 7d default
      interval: '7 days',
      bucket: `date_trunc('hour', ts)`,
    };
  }
}

function portRangeConfig(range: string): { interval: string; bucket: string } {
  const ts = 'recorded_at';
  switch (range) {
    case '30d': return {
      interval: '30 days',
      bucket: `to_timestamp(floor(extract(epoch from ${ts}) / ${3600 * 6}) * ${3600 * 6})`,
    };
    case '90d': return {
      interval: '90 days',
      bucket: `to_timestamp(floor(extract(epoch from ${ts}) / ${3600 * 12}) * ${3600 * 12})`,
    };
    case '1y': return {
      interval: '1 year',
      bucket: `date_trunc('day', ${ts})`,
    };
    default: return {
      interval: '7 days',
      bucket: `date_trunc('hour', ${ts})`,
    };
  }
}

export default async function analyticsRoutes(app: FastifyInstance) {
  // Device-level time-series: cpu, memory, temp, poe_used, poe_capacity
  app.get<{ Params: { id: string }; Querystring: { metric?: string; range?: string } }>(
    '/api/analytics/device/:id',
    { schema: { tags: ['analytics'] } },
    async (req, reply) => {
      try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'Authentication required' }); }
      const { id } = req.params;
      const metric = req.query.metric ?? 'cpu';
      const range = req.query.range ?? '7d';
      const { interval, bucket } = rangeConfig(range);

      const COLS: Record<string, string> = {
        cpu: 'AVG(cpu_pct)',
        memory: 'AVG(mem_pct)',
        temp: 'AVG(temperature_c)',
        poe_used: 'AVG(poe_watts_used)',
        poe_capacity: 'AVG(poe_watts_capacity)',
      };
      const agg = COLS[metric] ?? 'AVG(cpu_pct)';

      const { rows } = await query(
        `SELECT ${bucket} AS bucket, ROUND((${agg})::numeric, 1) AS value
         FROM device_metrics
         WHERE device_id = $1 AND ts > now() - interval '${interval}'
           AND ${agg.replace(/AVG\(([^)]+)\)/, '$1')} IS NOT NULL
         GROUP BY bucket ORDER BY bucket`,
        [id]
      );
      return rows;
    }
  );

  // Per-device availability % over a window, from the hourly rollup.
  app.get<{ Params: { id: string }; Querystring: { days?: string } }>(
    '/api/analytics/device/:id/availability',
    { schema: { tags: ['analytics'] } },
    async (req, reply) => {
      try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'Authentication required' }); }
      const days = Math.min(365, Math.max(1, parseInt(req.query.days ?? '30', 10) || 30));
      const { rows } = await query<{ up: number; total: number }>(
        `SELECT COALESCE(SUM(up),0)::int AS up, COALESCE(SUM(total),0)::int AS total
         FROM device_availability WHERE device_id = $1 AND hour > now() - ($2 * interval '1 day')`,
        [req.params.id, days]);
      const { up, total } = rows[0];
      return { days, up, total, pct: total > 0 ? Math.round((up / total) * 10000) / 100 : null };
    }
  );

  // Per-port time-series: in_bps, out_bps, in_errors, out_errors
  app.get<{ Params: { deviceId: string; portName: string }; Querystring: { range?: string } }>(
    '/api/analytics/port/:deviceId/:portName',
    { schema: { tags: ['analytics'] } },
    async (req, reply) => {
      try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'Authentication required' }); }
      const { deviceId, portName } = req.params;
      const { interval, bucket } = portRangeConfig(req.query.range ?? '7d');

      const { rows } = await query(
        `SELECT ${bucket} AS bucket,
                ROUND(AVG(in_bps)::numeric, 0)     AS in_bps,
                ROUND(AVG(out_bps)::numeric, 0)    AS out_bps,
                ROUND(AVG(in_errors)::numeric, 1)  AS in_errors,
                ROUND(AVG(out_errors)::numeric, 1) AS out_errors
         FROM port_metrics
         WHERE device_id = $1 AND port_name = $2
           AND recorded_at > now() - interval '${interval}'
         GROUP BY bucket ORDER BY bucket`,
        [deviceId, portName]
      );
      return rows;
    }
  );

  // List ports that have metric data (for port selector in UI)
  app.get<{ Params: { deviceId: string } }>(
    '/api/analytics/port/:deviceId',
    { schema: { tags: ['analytics'] } },
    async (req, reply) => {
      try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'Authentication required' }); }
      const { rows } = await query(
        `SELECT DISTINCT port_name
         FROM port_metrics WHERE device_id = $1 AND in_bps IS NOT NULL
         ORDER BY port_name`,
        [req.params.deviceId]
      );
      return rows.map(r => r.port_name);
    }
  );

  // VLAN summary: named VLANs + access port membership + trunk ports
  app.get<{ Params: { id: string } }>(
    '/api/analytics/device/:id/vlans',
    { schema: { tags: ['analytics'] } },
    async (req, reply) => {
      try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'Authentication required' }); }
      const { id } = req.params;

      const [vlanRows, trunkRows] = await Promise.all([
        query(
          `SELECT vlan_id AS id, name, ports
           FROM device_vlans
           WHERE device_id = $1 AND vlan_id != 1002 AND vlan_id != 1003
             AND vlan_id != 1004 AND vlan_id != 1005
           ORDER BY vlan_id`,
          [id]
        ),
        query(
          `SELECT name FROM ports
           WHERE device_id = $1 AND mode = 'trunk' AND admin_up = true
           ORDER BY name`,
          [id]
        ),
      ]);

      return {
        vlans: vlanRows.rows.map(r => ({ id: r.id, name: r.name, ports: r.ports ?? [] })),
        trunkPorts: trunkRows.rows.map(r => r.name),
      };
    }
  );
}
