// Outbound webhooks + API keys: the programmatic surface of the platform.
import type { FastifyInstance } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { query } from '../db.js';
import { audit } from '../audit.js';
import { requireRole } from '../auth/rbac.js';
import { fireWebhooks, invalidateWebhookCache, testNotifiers } from '../services/alertService.js';

export default async function integrationRoutes(app: FastifyInstance) {
  // ----- Webhook subscriptions -----
  app.get('/api/webhooks', { preHandler: requireRole('netadmin'), schema: { tags: ['integrations'] } },
    async () => (await query(
      `SELECT id, name, url, secret != '' AS signed, min_severity, enabled,
              created_by, created_at, last_fired_at, last_status
       FROM webhook_subscriptions ORDER BY name`)).rows);

  app.post('/api/webhooks', {
    preHandler: requireRole('netadmin'),
    schema: {
      tags: ['integrations'],
      body: {
        type: 'object', required: ['name', 'url'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          url: { type: 'string', pattern: '^https?://' },
          secret: { type: 'string', maxLength: 200 },
          minSeverity: { type: 'string', enum: ['info', 'warning', 'critical'], default: 'warning' }
        }
      }
    }
  }, async (req, reply) => {
    const b = req.body as any;
    const me = req.user as any;
    const { rows } = await query(
      `INSERT INTO webhook_subscriptions (name, url, secret, min_severity, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, name, url, min_severity, enabled`,
      [b.name, b.url, b.secret ?? '', b.minSeverity ?? 'warning', me.username]);
    invalidateWebhookCache();
    await audit(me.username, 'webhook.create', b.name, { url: b.url }, req.ip);
    return reply.code(201).send(rows[0]);
  });

  app.put('/api/webhooks/:id', {
    preHandler: requireRole('netadmin'),
    schema: {
      tags: ['integrations'],
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' }, url: { type: 'string', pattern: '^https?://' },
          secret: { type: 'string' }, minSeverity: { type: 'string', enum: ['info', 'warning', 'critical'] },
          enabled: { type: 'boolean' }
        }
      }
    }
  }, async (req, reply) => {
    const b = req.body as any;
    const { id } = req.params as any;
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [col, val] of Object.entries({
      name: b.name, url: b.url, secret: b.secret, min_severity: b.minSeverity, enabled: b.enabled
    })) {
      if (val !== undefined) { params.push(val); sets.push(`${col}=$${params.length}`); }
    }
    if (!sets.length) return reply.code(400).send({ error: 'Nothing to update' });
    params.push(id);
    const { rows } = await query(
      `UPDATE webhook_subscriptions SET ${sets.join(', ')} WHERE id=$${params.length} RETURNING id`, params);
    if (!rows[0]) return reply.code(404).send({ error: 'Webhook not found' });
    invalidateWebhookCache();
    return { ok: true };
  });

  app.delete('/api/webhooks/:id', { preHandler: requireRole('netadmin'), schema: { tags: ['integrations'] } },
    async (req) => {
      const me = req.user as any;
      await query('DELETE FROM webhook_subscriptions WHERE id=$1', [(req.params as any).id]);
      invalidateWebhookCache();
      await audit(me.username, 'webhook.delete', (req.params as any).id, {}, req.ip);
      return { ok: true };
    });

  // Fire a synthetic alert at one subscription so operators can verify wiring
  app.post('/api/webhooks/:id/test', { preHandler: requireRole('netadmin'), schema: { tags: ['integrations'] } },
    async (req, reply) => {
      const { rows } = await query('SELECT * FROM webhook_subscriptions WHERE id=$1', [(req.params as any).id]);
      if (!rows[0]) return reply.code(404).send({ error: 'Webhook not found' });
      await fireWebhooks({
        event: 'test', deviceId: null, hostname: 'platform', kind: 'webhook_test',
        severity: 'critical',   // bypasses min_severity so the test always fires
        message: `Test delivery for webhook "${rows[0].name}"`, ts: new Date().toISOString()
      });
      const after = await query('SELECT last_status FROM webhook_subscriptions WHERE id=$1', [(req.params as any).id]);
      return { ok: true, lastStatus: after.rows[0].last_status };
    });

  // Fire a test through every configured env-var notifier (Slack/Teams/Discord/
  // ntfy/Gotify/Telegram/Pushover/Email) so operators can verify wiring without
  // waiting for a real alert. Returns a per-channel result.
  app.post('/api/integrations/test-notifier', {
    preHandler: requireRole('netadmin'),
    schema: { tags: ['integrations'], response: { 200: {
      type: 'object', additionalProperties: true,
      properties: { results: { type: 'array', items: { type: 'object', additionalProperties: true } } },
    } } },
  }, async (req) => {
    const results = await testNotifiers();
    const me = req.user as any;
    await audit(me.username, 'notifier.test', 'platform', { channels: results.map(r => `${r.channel}:${r.ok ? 'ok' : 'fail'}`) }, req.ip);
    return { results };
  });

  // ----- API keys -----
  app.get('/api/keys', { preHandler: requireRole('superadmin'), schema: { tags: ['integrations'] } },
    async () => (await query(
      `SELECT id, name, role, enabled, created_by, created_at, last_used_at FROM api_keys ORDER BY created_at DESC`)).rows);

  app.post('/api/keys', {
    preHandler: requireRole('superadmin'),
    schema: {
      tags: ['integrations'],
      body: {
        type: 'object', required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          role: { type: 'string', enum: ['superadmin', 'netadmin', 'helpdesk', 'readonly'], default: 'readonly' }
        }
      }
    }
  }, async (req, reply) => {
    const b = req.body as any;
    const me = req.user as any;
    const token = `sp_${randomBytes(24).toString('hex')}`;
    const { rows } = await query(
      `INSERT INTO api_keys (name, key_hash, role, created_by) VALUES ($1,$2,$3,$4)
       RETURNING id, name, role, created_at`,
      [b.name, createHash('sha256').update(token).digest('hex'), b.role ?? 'readonly', me.username]);
    await audit(me.username, 'apikey.create', b.name, { role: b.role ?? 'readonly' }, req.ip);
    // The plaintext token is returned exactly once - only the hash is stored
    return reply.code(201).send({ ...rows[0], token });
  });

  app.delete('/api/keys/:id', { preHandler: requireRole('superadmin'), schema: { tags: ['integrations'] } },
    async (req) => {
      const me = req.user as any;
      await query('DELETE FROM api_keys WHERE id=$1', [(req.params as any).id]);
      await audit(me.username, 'apikey.delete', (req.params as any).id, {}, req.ip);
      return { ok: true };
    });
}
