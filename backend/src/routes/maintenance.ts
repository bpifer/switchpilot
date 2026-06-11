import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { audit } from '../audit.js';
import { requireRole } from '../auth/rbac.js';

export default async function maintenanceRoutes(app: FastifyInstance) {
  // List maintenance windows (active + upcoming + recently expired)
  app.get('/api/maintenance', { preHandler: requireRole('readonly'), schema: { tags: ['maintenance'] } },
    async () => {
      const { rows } = await query(
        `SELECT * FROM maintenance_windows
         WHERE ends_at > now() - interval '7 days'
         ORDER BY starts_at DESC`);
      return rows;
    });

  // Create a maintenance window
  app.post('/api/maintenance', {
    preHandler: requireRole('netadmin'),
    schema: {
      tags: ['maintenance'],
      body: {
        type: 'object', required: ['name', 'startsAt', 'endsAt'],
        properties: {
          name:      { type: 'string', minLength: 1 },
          deviceIds: { type: 'array', items: { type: 'string' }, description: 'Leave empty to suppress all devices' },
          startsAt:  { type: 'string', format: 'date-time' },
          endsAt:    { type: 'string', format: 'date-time' }
        }
      }
    }
  }, async (req, reply) => {
    const b = req.body as any;
    const me = req.user as any;
    const { rows } = await query(
      `INSERT INTO maintenance_windows (name, device_ids, starts_at, ends_at, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [b.name, b.deviceIds ?? [], new Date(b.startsAt), new Date(b.endsAt), me.username]);
    await audit(me.username, 'maintenance.create', rows[0].id, { name: b.name }, req.ip);
    return reply.code(201).send(rows[0]);
  });

  // Delete / cancel a maintenance window
  app.delete('/api/maintenance/:id', { preHandler: requireRole('netadmin'), schema: { tags: ['maintenance'] } },
    async (req, reply) => {
      const me = req.user as any;
      const { id } = req.params as any;
      const { rowCount } = await query('DELETE FROM maintenance_windows WHERE id=$1', [id]);
      if (!rowCount) return reply.code(404).send({ error: 'Not found' });
      await audit(me.username, 'maintenance.delete', id, {}, req.ip);
      return { ok: true };
    });
}
