// Global search for the Cmd+K command palette: devices, ports, alerts, logs,
// config-backup content, and failing compliance rules.
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
    const [devices, ports, alerts, logs, configs, compliance] = await Promise.all([
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
         ORDER BY l.received_at DESC LIMIT 6`, [like]),
      // Config content: match against each device's LATEST backup only, so a
      // hit reflects the current config, not a stale historical one. Content is
      // not returned (can be large) — just which device + when.
      query(
        `SELECT latest.device_id, latest.hostname, latest.created_at
         FROM (
           SELECT DISTINCT ON (cb.device_id) cb.device_id, cb.content, cb.created_at, d.hostname
           FROM config_backups cb JOIN devices d ON d.id = cb.device_id
           ORDER BY cb.device_id, cb.created_at DESC
         ) latest
         WHERE latest.content ILIKE $1
         ORDER BY latest.hostname LIMIT 6`, [like]),
      // Failing compliance rules, findable by rule name/description.
      query(
        `SELECT r.device_id, d.hostname, cr.id AS rule_id, cr.name, cr.severity
         FROM compliance_results r
         JOIN compliance_rules cr ON cr.id = r.rule_id
         JOIN devices d ON d.id = r.device_id
         WHERE r.passed = false AND (cr.name ILIKE $1 OR cr.description ILIKE $1)
         ORDER BY CASE cr.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, d.hostname
         LIMIT 6`, [like])
    ]);

    return {
      devices: devices.rows,
      ports: ports.rows,
      alerts: alerts.rows,
      logs: logs.rows,
      configs: configs.rows,
      compliance: compliance.rows
    };
  });
}
