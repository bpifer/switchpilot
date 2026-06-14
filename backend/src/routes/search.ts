// Global search for the Cmd+K command palette: devices, ports, alerts, logs.
import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { requireRole } from '../auth/rbac.js';

export default async function searchRoutes(app: FastifyInstance) {
  app.get('/api/search', {
    preHandler: requireRole('readonly'),
    schema: {
      tags: ['search'],
      querystring: {
        type: 'object', required: ['q'],
        properties: { q: { type: 'string', minLength: 1, maxLength: 100 } }
      }
    }
  }, async (req) => {
    const raw = (req.query as any).q as string;
    // Escape LIKE metacharacters so a user typing % or _ searches literally
    const like = `%${raw.trim().replace(/[%_\\]/g, '\\$&')}%`;

    // Each query is capped low; the palette shows the most relevant few per type
    const [devices, ports, alerts, logs] = await Promise.all([
      query(
        `SELECT id, hostname, host(mgmt_ip) AS mgmt_ip, model, status
         FROM devices
         WHERE hostname ILIKE $1 OR host(mgmt_ip) ILIKE $1 OR model ILIKE $1 OR serial_number ILIKE $1
         ORDER BY hostname LIMIT 8`, [like]),
      query(
        `SELECT p.device_id, p.name, p.description, p.vlan, d.hostname
         FROM ports p JOIN devices d ON d.id = p.device_id
         WHERE p.description ILIKE $1 AND p.description != ''
         ORDER BY d.hostname, p.name LIMIT 6`, [like]),
      query(
        `SELECT a.id, a.device_id, a.severity, a.kind, a.message, a.created_at, d.hostname
         FROM alerts a LEFT JOIN devices d ON d.id = a.device_id
         WHERE a.resolved_at IS NULL AND (a.message ILIKE $1 OR a.kind ILIKE $1)
         ORDER BY a.created_at DESC LIMIT 6`, [like]),
      query(
        `SELECT l.id, l.device_id, l.message, l.severity, l.received_at, d.hostname
         FROM syslog_messages l LEFT JOIN devices d ON d.id = l.device_id
         WHERE l.message ILIKE $1
         ORDER BY l.received_at DESC LIMIT 6`, [like])
    ]);

    return {
      devices: devices.rows,
      ports: ports.rows,
      alerts: alerts.rows,
      logs: logs.rows
    };
  });
}
