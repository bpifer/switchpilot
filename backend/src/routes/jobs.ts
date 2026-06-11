import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { audit } from '../audit.js';
import { requireRole } from '../auth/rbac.js';
import { createJob } from '../services/jobService.js';

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
          type: { type: 'string', enum: ['config_push', 'backup', 'compliance'] },
          name: { type: 'string' },
          payload: { type: 'object' },
          deviceIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
          scheduleAt: { type: 'string', format: 'date-time' }
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
      createdBy: me.username
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
}
