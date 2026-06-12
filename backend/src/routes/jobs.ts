import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { audit } from '../audit.js';
import { requireRole } from '../auth/rbac.js';
import { createJob, retryJob } from '../services/jobService.js';

export default async function jobRoutes(app: FastifyInstance) {
  app.get('/api/jobs', {
    preHandler: requireRole('readonly'),
    schema: {
      tags: ['jobs'],
      querystring: { type: 'object', properties: { limit: { type: 'integer', default: 100 } } }
    }
  }, async (req) => {
    const limit = Math.min((req.query as any).limit ?? 100, 500);
    const { rows } = await query('SELECT * FROM jobs ORDER BY created_at DESC LIMIT $1', [limit]);
    return rows;
  });

  // Clear finished history (running/pending jobs are never touched).
  // Registered before /:id so "finished" isn't captured as an id.
  app.delete('/api/jobs/finished', { preHandler: requireRole('netadmin'), schema: { tags: ['jobs'] } },
    async (req) => {
      const me = req.user as any;
      const { rowCount } = await query(`DELETE FROM jobs WHERE status IN ('done','failed','cancelled')`);
      await audit(me.username, 'jobs.clear', 'finished', { removed: rowCount }, req.ip);
      return { removed: rowCount };
    });

  app.get('/api/jobs/:id', { preHandler: requireRole('readonly'), schema: { tags: ['jobs'] } },
    async (req, reply) => {
      const { id } = req.params as any;
      const job = await query('SELECT * FROM jobs WHERE id=$1', [id]);
      if (!job.rows[0]) return reply.code(404).send({ error: 'Job not found' });
      const results = await query(
        `SELECT r.*, d.hostname FROM job_results r LEFT JOIN devices d ON d.id=r.device_id
         WHERE r.job_id=$1 ORDER BY r.finished_at`, [id]);
      return { ...job.rows[0], results: results.rows };
    });

  // Generic bulk config push job (lines or template via /api/templates/:id/deploy)
  app.post('/api/jobs', {
    preHandler: requireRole('netadmin'),
    schema: {
      tags: ['jobs'],
      body: {
        type: 'object', required: ['type', 'deviceIds'],
        properties: {
          type: { type: 'string', enum: ['config_push', 'backup', 'compliance', 'firmware_upgrade', 'bounce_port', 'custom'] },
          name: { type: 'string' },
          payload: { type: 'object' },
          deviceIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
          scheduleAt: { type: 'string', format: 'date-time' },
          cron: { type: 'string', description: 'Cron expression for recurring jobs (e.g. "0 2 * * *")' },
          maxAttempts: { type: 'integer', minimum: 1, maximum: 10, default: 1, description: 'Retry attempts before the job is marked failed' }
        }
      }
    }
  }, async (req, reply) => {
    const b = req.body as any;
    const me = req.user as any;
    const job = await createJob({
      type: b.type,
      name: b.name ?? b.type,
      payload: b.payload ?? {},
      deviceIds: b.deviceIds,
      scheduleAt: b.scheduleAt ? new Date(b.scheduleAt) : null,
      cron: b.cron ?? null,
      createdBy: me.username,
      maxAttempts: b.maxAttempts ?? 1
    });
    await audit(me.username, 'job.create', b.type, { deviceIds: b.deviceIds }, req.ip);
    return reply.code(202).send(job);
  });

  app.post('/api/jobs/:id/cancel', { preHandler: requireRole('netadmin'), schema: { tags: ['jobs'] } },
    async (req) => {
      const me = req.user as any;
      await query(`UPDATE jobs SET status='cancelled' WHERE id=$1 AND status='pending'`, [(req.params as any).id]);
      await audit(me.username, 'job.cancel', (req.params as any).id, {}, req.ip);
      return { ok: true };
    });

  // Re-run a failed job (bumps max_attempts so the queue picks it up again).
  app.post('/api/jobs/:id/retry', { preHandler: requireRole('netadmin'), schema: { tags: ['jobs'] } },
    async (req, reply) => {
      const me = req.user as any;
      const { id } = req.params as any;
      const ok = await retryJob(id);
      if (!ok) return reply.code(409).send({ error: 'Job is not in a failed state' });
      await audit(me.username, 'job.retry', id, {}, req.ip);
      return { ok: true };
    });
}
