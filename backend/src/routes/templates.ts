import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { audit } from '../audit.js';
import { requireRole } from '../auth/rbac.js';
import { renderTemplate, capabilitiesSatisfied } from '../services/templateService.js';
import { getDevice } from '../services/deviceComms.js';
import { createJob } from '../services/jobService.js';

export default async function templateRoutes(app: FastifyInstance) {
  app.get('/api/templates', { preHandler: requireRole('readonly'), schema: { tags: ['templates'] } },
    async () => (await query('SELECT * FROM templates ORDER BY name')).rows);

  app.post('/api/templates', {
    preHandler: requireRole('netadmin'),
    schema: {
      tags: ['templates'],
      body: {
        type: 'object', required: ['name', 'body'],
        properties: {
          name: { type: 'string' }, description: { type: 'string' },
          category: { type: 'string' }, body: { type: 'string' },
          variables: { type: 'array', items: { type: 'object' } },
          minCapabilities: { type: 'array', items: { type: 'string' } }
        }
      }
    }
  }, async (req, reply) => {
    const b = req.body as any;
    const me = req.user as any;
    const { rows } = await query(
      `INSERT INTO templates (name, description, category, body, variables, min_capabilities, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [b.name, b.description ?? '', b.category ?? 'general', b.body,
       JSON.stringify(b.variables ?? []), JSON.stringify(b.minCapabilities ?? []), me.username]);
    await audit(me.username, 'template.create', b.name, {}, req.ip);
    return reply.code(201).send(rows[0]);
  });

  app.patch('/api/templates/:id', {
    preHandler: requireRole('netadmin'),
    schema: { tags: ['templates'], body: { type: 'object' } }
  }, async (req) => {
    const { id } = req.params as any;
    const b = req.body as any;
    const me = req.user as any;
    if (b.body !== undefined) await query('UPDATE templates SET body=$1, updated_at=now() WHERE id=$2', [b.body, id]);
    if (b.description !== undefined) await query('UPDATE templates SET description=$1, updated_at=now() WHERE id=$2', [b.description, id]);
    if (b.variables !== undefined) await query('UPDATE templates SET variables=$1, updated_at=now() WHERE id=$2', [JSON.stringify(b.variables), id]);
    await audit(me.username, 'template.update', id, {}, req.ip);
    return { ok: true };
  });

  app.delete('/api/templates/:id', { preHandler: requireRole('netadmin'), schema: { tags: ['templates'] } },
    async (req) => {
      const me = req.user as any;
      await query('DELETE FROM templates WHERE id=$1', [(req.params as any).id]);
      await audit(me.username, 'template.delete', (req.params as any).id, {}, req.ip);
      return { ok: true };
    });

  // Preview rendered output without pushing
  app.post('/api/templates/:id/render', {
    preHandler: requireRole('readonly'),
    schema: {
      tags: ['templates'],
      body: { type: 'object', properties: { variables: { type: 'object' } } }
    }
  }, async (req) => {
    const lines = await renderTemplate((req.params as any).id, (req.body as any)?.variables ?? {});
    return { lines };
  });

  // Deploy template to one or many devices — runs as a job (now or scheduled)
  app.post('/api/templates/:id/deploy', {
    preHandler: requireRole('netadmin'),
    schema: {
      tags: ['templates'],
      body: {
        type: 'object', required: ['deviceIds'],
        properties: {
          deviceIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
          variables: { type: 'object' },
          scheduleAt: { type: 'string', format: 'date-time' }
        }
      }
    }
  }, async (req, reply) => {
    const { id } = req.params as any;
    const { deviceIds, variables, scheduleAt } = req.body as any;
    const me = req.user as any;

    // capability gate: refuse devices that don't support the template
    const { rows: tplRows } = await query('SELECT name, min_capabilities FROM templates WHERE id=$1', [id]);
    if (!tplRows[0]) return reply.code(404).send({ error: 'Template not found' });
    const incompatible: string[] = [];
    for (const deviceId of deviceIds) {
      const device = await getDevice(deviceId);
      const check = capabilitiesSatisfied(tplRows[0].min_capabilities ?? [], device.capabilities ?? {});
      if (!check.ok) incompatible.push(`${device.hostname}: missing ${check.missing.join(', ')}`);
    }
    if (incompatible.length) {
      return reply.code(400).send({ error: 'Template not supported on all selected devices', detail: incompatible });
    }

    const job = await createJob({
      type: 'config_push',
      name: `Deploy template "${tplRows[0].name}"`,
      payload: { templateId: id, variables: variables ?? {} },
      deviceIds,
      scheduleAt: scheduleAt ? new Date(scheduleAt) : null,
      createdBy: me.username
    });
    await audit(me.username, 'template.deploy', id, { deviceIds, scheduleAt }, req.ip);
    return reply.code(202).send(job);
  });
}
