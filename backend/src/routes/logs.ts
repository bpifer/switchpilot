import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { requireRole } from '../auth/rbac.js';

export default async function logRoutes(app: FastifyInstance) {
  // Syslog viewer: filter by device, max severity (0=emerg..7=debug), text search
  app.get('/api/logs', {
    preHandler: requireRole('readonly'),
    schema: {
      tags: ['logs'],
      querystring: {
        type: 'object',
        properties: {
          deviceId: { type: 'string' },
          severity: { type: 'integer', minimum: 0, maximum: 7, description: 'show messages at this severity or more urgent' },
          q: { type: 'string', maxLength: 200 },
          limit: { type: 'integer', minimum: 1, maximum: 1000, default: 200 }
        }
      }
    }
  }, async (req) => {
    const { deviceId, severity, q, limit } = req.query as any;
    const conds: string[] = [];
    const params: unknown[] = [];
    if (deviceId) { params.push(deviceId); conds.push(`l.device_id = $${params.length}`); }
    if (severity !== undefined) { params.push(severity); conds.push(`(l.severity IS NULL OR l.severity <= $${params.length})`); }
    if (q) { params.push(`%${q}%`); conds.push(`l.message ILIKE $${params.length}`); }
    params.push(limit ?? 200);
    const { rows } = await query(
      `SELECT l.id, l.device_id, d.hostname, l.source_ip, l.facility, l.severity,
              l.message, l.received_at
       FROM syslog_messages l
       LEFT JOIN devices d ON d.id = l.device_id
       ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
       ORDER BY l.received_at DESC
       LIMIT $${params.length}`, params);
    return rows;
  });
}
