import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { requireRole } from '../auth/rbac.js';
import { gitLog } from '../services/configVersioning.js';

interface TimelineEvent {
  ts: string;
  kind: 'config' | 'audit' | 'alert' | 'job';
  title: string;
  by?: string;
  severity?: string;
  meta?: string;
}

export default async function timelineRoutes(app: FastifyInstance) {
  // Unified per-device activity feed: stitches config-history commits, the audit
  // log, alerts, and job results into one chronological timeline. Pure read-only
  // aggregation over data that already exists - no new collection.
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/api/devices/:id/timeline',
    { preHandler: requireRole('readonly'), schema: { tags: ['devices'] } },
    async (req) => {
      const { id } = req.params;
      const limit = Math.min(parseInt(req.query.limit ?? '60', 10) || 60, 200);
      const PER = 60;   // pull this many of each source, then merge + trim

      const [audit, alerts, jobs, dev] = await Promise.all([
        // audit targets are the device id, or `id/<port|vlan>` for sub-resources
        query(`SELECT created_at AS ts, action, target, username
               FROM audit_log WHERE target = $1 OR target LIKE $1 || '/%'
               ORDER BY created_at DESC LIMIT ${PER}`, [id]),
        query(`SELECT created_at AS ts, severity, kind, message, resolved_at
               FROM alerts WHERE device_id = $1 ORDER BY created_at DESC LIMIT ${PER}`, [id]),
        query(`SELECT jr.finished_at AS ts, j.type, j.name, jr.success
               FROM job_results jr JOIN jobs j ON j.id = jr.job_id
               WHERE jr.device_id = $1 ORDER BY jr.finished_at DESC LIMIT ${PER}`, [id]),
        query<{ hostname: string; site: string | null }>(
          `SELECT d.hostname, s.name AS site FROM devices d
           LEFT JOIN sites s ON s.id = d.site_id WHERE d.id = $1`, [id]),
      ]);

      const events: TimelineEvent[] = [];
      for (const r of audit.rows) {
        const sub = r.target !== id ? ` ${String(r.target).replace(`${id}/`, '')}` : '';
        events.push({ ts: r.ts, kind: 'audit', title: `${r.action}${sub}`, by: r.username });
      }
      for (const r of alerts.rows) {
        events.push({ ts: r.ts, kind: 'alert', severity: r.severity, title: r.message,
          meta: r.resolved_at ? 'resolved' : 'open' });
      }
      for (const r of jobs.rows) {
        events.push({ ts: r.ts, kind: 'job', title: r.name || r.type, meta: r.success ? 'ok' : 'failed' });
      }
      // Config-history commits (git). Best-effort: gitLog already returns [] on error.
      const d = dev.rows[0];
      if (d) {
        const commits = await gitLog(d.hostname, d.site, PER).catch(() => []);
        for (const c of commits) {
          events.push({ ts: c.date, kind: 'config', title: c.subject || 'config change', by: c.author });
        }
      }

      events.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
      return events.slice(0, limit);
    });
}
