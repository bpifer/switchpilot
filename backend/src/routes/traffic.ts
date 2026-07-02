import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { requireRole } from '../auth/rbac.js';
import { audit, redactForAudit } from '../audit.js';
import { config } from '../config.js';
import { configureFlowExport } from '../services/deviceComms.js';

// Detailed flow data is short-lived; offer short ranges with sensible buckets.
// The interval/bucket strings come from this fixed allowlist (never user input),
// so they are safe to interpolate; the deviceId filter is parameterized.
function rangeConfig(range: string): { interval: string; bucket: string } {
  switch (range) {
    case '1h': return { interval: '1 hour',   bucket: `date_trunc('minute', bucket)` };
    case '7d': return { interval: '7 days',   bucket: `date_trunc('hour', bucket)` };
    default:   return { interval: '24 hours', bucket: `date_trunc('hour', bucket)` };   // 24h
  }
}

export default async function trafficRoutes(app: FastifyInstance) {
  // Collector status + whether any data has landed (drives the empty state).
  app.get('/api/traffic/status', { preHandler: requireRole('readonly'), schema: { tags: ['traffic'] } },
    async () => {
      const { rows } = await query<{ n: number; latest: string | null }>(
        `SELECT count(*)::int AS n, max(bucket) AS latest FROM flow_records`);
      return { enabled: config.netflow.enabled, port: config.netflow.port, records: rows[0].n, latest: rows[0].latest };
    });

  // Top talkers: hosts by total bytes, counting traffic in either direction.
  app.get<{ Querystring: { range?: string; deviceId?: string } }>(
    '/api/traffic/top-talkers', { preHandler: requireRole('readonly'), schema: { tags: ['traffic'] } },
    async (req) => {
      const { interval } = rangeConfig(req.query.range ?? '24h');
      const dev = req.query.deviceId;
      const filter = dev ? 'AND device_id = $1' : '';
      const params = dev ? [dev] : [];
      const { rows } = await query(
        `SELECT host(h)::text AS host, sum(bytes)::bigint AS bytes, sum(packets)::bigint AS packets
         FROM (
           SELECT src_ip AS h, bytes, packets FROM flow_records WHERE bucket > now() - interval '${interval}' ${filter}
           UNION ALL
           SELECT dst_ip AS h, bytes, packets FROM flow_records WHERE bucket > now() - interval '${interval}' ${filter}
         ) t
         GROUP BY h ORDER BY bytes DESC LIMIT 20`, params);
      return rows;
    });

  // Application breakdown by bytes.
  app.get<{ Querystring: { range?: string; deviceId?: string } }>(
    '/api/traffic/apps', { preHandler: requireRole('readonly'), schema: { tags: ['traffic'] } },
    async (req) => {
      const { interval } = rangeConfig(req.query.range ?? '24h');
      const dev = req.query.deviceId;
      const filter = dev ? 'AND device_id = $1' : '';
      const params = dev ? [dev] : [];
      const { rows } = await query(
        `SELECT app, sum(bytes)::bigint AS bytes FROM flow_records
         WHERE bucket > now() - interval '${interval}' ${filter}
         GROUP BY app ORDER BY bytes DESC LIMIT 15`, params);
      return rows;
    });

  // Total bytes over time (area chart).
  app.get<{ Querystring: { range?: string; deviceId?: string } }>(
    '/api/traffic/series', { preHandler: requireRole('readonly'), schema: { tags: ['traffic'] } },
    async (req) => {
      const { interval, bucket } = rangeConfig(req.query.range ?? '24h');
      const dev = req.query.deviceId;
      const filter = dev ? 'AND device_id = $1' : '';
      const params = dev ? [dev] : [];
      const { rows } = await query(
        `SELECT ${bucket} AS bucket, sum(bytes)::bigint AS bytes FROM flow_records
         WHERE bucket > now() - interval '${interval}' ${filter}
         GROUP BY 1 ORDER BY 1`, params);
      return rows;
    });

  // Point a device's flow export (NetFlow/IPFIX) at this collector. Idempotent;
  // netadmin-only since it writes device config. RouterOS validated on hardware;
  // Cisco IOS-XE Flexible NetFlow validated on a C9300 (17.03.07); NX-OS -> 501.
  app.post<{ Params: { id: string } }>('/api/devices/:id/flow-export',
    { preHandler: requireRole('netadmin'), schema: { tags: ['traffic'] } },
    async (req) => {
      const me = req.user as any;
      const output = await configureFlowExport(req.params.id);
      await audit(me.username, 'device.flow_export.enable', req.params.id,
        { output: redactForAudit(output), port: config.netflow.port }, req.ip);
      return { ok: true, output };
    });
}
