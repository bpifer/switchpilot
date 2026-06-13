import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { audit } from '../audit.js';
import { requireRole } from '../auth/rbac.js';
import { siteFilter } from './util.js';

export default async function alertRoutes(app: FastifyInstance) {
  app.get('/api/alerts', {
    preHandler: requireRole('readonly'),
    schema: {
      tags: ['alerts'],
      querystring: {
        type: 'object',
        properties: {
          open: { type: 'boolean', default: true },
          limit: { type: 'integer', default: 200 },
          siteId: { type: 'string' }
        }
      }
    }
  }, async (req) => {
    const q = req.query as any;
    const conds: string[] = [];
    const params: unknown[] = [];
    if (q.open !== false) conds.push('a.resolved_at IS NULL');
    const sf = siteFilter(q.siteId, 'd', params.length + 1);
    if (sf.cond) { conds.push(sf.cond); params.push(...sf.params); }
    params.push(Math.min(q.limit ?? 200, 1000));
    const { rows } = await query(
      `SELECT a.*, d.hostname, d.mgmt_ip FROM alerts a
       LEFT JOIN devices d ON d.id=a.device_id
       ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
       ORDER BY a.created_at DESC LIMIT $${params.length}`, params);
    return rows;
  });

  app.post('/api/alerts/:id/ack', { preHandler: requireRole('helpdesk'), schema: { tags: ['alerts'] } },
    async (req) => {
      const me = req.user as any;
      await query('UPDATE alerts SET acknowledged=TRUE, acknowledged_by=$1 WHERE id=$2',
        [me.username, (req.params as any).id]);
      return { ok: true };
    });

  app.post('/api/alerts/:id/resolve', { preHandler: requireRole('helpdesk'), schema: { tags: ['alerts'] } },
    async (req) => {
      await query('UPDATE alerts SET resolved_at=now() WHERE id=$1', [(req.params as any).id]);
      return { ok: true };
    });

  // ----- Automation rules -----
  app.get('/api/automation/rules', { preHandler: requireRole('readonly'), schema: { tags: ['automation'] } },
    async () => (await query('SELECT * FROM automation_rules ORDER BY name')).rows);

  app.post('/api/automation/rules', {
    preHandler: requireRole('netadmin'),
    schema: {
      tags: ['automation'],
      body: {
        type: 'object', required: ['name', 'trigger', 'action'],
        properties: {
          name: { type: 'string' },
          trigger: {
            type: 'string',
            enum: ['port_down', 'device_offline', 'cpu_high', 'config_drift', 'temp_high', 'psu_fail', 'fan_fail', 'port_flapping']
          },
          condition: { type: 'object' },
          action: { type: 'string', enum: ['notify', 'restore_baseline', 'run_template', 'disable_port'] },
          actionParams: { type: 'object' },
          enabled: { type: 'boolean', default: true }
        }
      }
    }
  }, async (req, reply) => {
    const b = req.body as any;
    const me = req.user as any;
    const { rows } = await query(
      `INSERT INTO automation_rules (name, trigger, condition, action, action_params, enabled, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [b.name, b.trigger, JSON.stringify(b.condition ?? {}), b.action,
       JSON.stringify(b.actionParams ?? {}), b.enabled ?? true, me.username]);
    await audit(me.username, 'automation.create', b.name, b, req.ip);
    return reply.code(201).send(rows[0]);
  });

  app.patch('/api/automation/rules/:id', {
    preHandler: requireRole('netadmin'),
    schema: { tags: ['automation'], body: { type: 'object', properties: { enabled: { type: 'boolean' } } } }
  }, async (req) => {
    const { enabled } = req.body as any;
    if (enabled !== undefined) {
      await query('UPDATE automation_rules SET enabled=$1 WHERE id=$2', [enabled, (req.params as any).id]);
    }
    return { ok: true };
  });

  app.delete('/api/automation/rules/:id', { preHandler: requireRole('netadmin'), schema: { tags: ['automation'] } },
    async (req) => {
      const me = req.user as any;
      await query('DELETE FROM automation_rules WHERE id=$1', [(req.params as any).id]);
      await audit(me.username, 'automation.delete', (req.params as any).id, {}, req.ip);
      return { ok: true };
    });
}
