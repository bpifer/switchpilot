import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { createTwoFilesPatch } from 'diff';
import { query } from '../db.js';
import { audit } from '../audit.js';
import { requireRole } from '../auth/rbac.js';
import { deviceExec, devicePushConfig } from '../services/deviceComms.js';
import { backupDevice } from '../services/configService.js';
import { gitLog, gitShow } from '../services/configVersioning.js';

export default async function configRoutes(app: FastifyInstance) {
  // Live running/startup config
  app.get('/api/devices/:id/config/:kind', {
    preHandler: requireRole('readonly'),
    schema: {
      tags: ['configs'],
      params: {
        type: 'object',
        properties: { id: { type: 'string' }, kind: { type: 'string', enum: ['running', 'startup'] } }
      }
    }
  }, async (req) => {
    const { id, kind } = req.params as any;
    const cmd = kind === 'startup' ? 'show startup-config' : 'show running-config';
    const out = await deviceExec(id, [cmd]);
    return { kind, content: Object.values(out)[0] ?? '' };
  });

  // Backups
  app.get('/api/devices/:id/backups', { preHandler: requireRole('readonly'), schema: { tags: ['configs'] } },
    async (req) => {
      const { rows } = await query(
        `SELECT id, kind, sha256, taken_by, created_at, length(content) AS size
         FROM config_backups WHERE device_id=$1 ORDER BY created_at DESC LIMIT 100`,
        [(req.params as any).id]);
      return rows;
    });

  app.get('/api/backups/:backupId', { preHandler: requireRole('readonly'), schema: { tags: ['configs'] } },
    async (req, reply) => {
      const { rows } = await query('SELECT * FROM config_backups WHERE id=$1', [(req.params as any).backupId]);
      if (!rows[0]) return reply.code(404).send({ error: 'Backup not found' });
      return rows[0];
    });

  app.post('/api/devices/:id/backups', { preHandler: requireRole('helpdesk'), schema: { tags: ['configs'] } },
    async (req, reply) => {
      const me = req.user as any;
      const backup = await backupDevice((req.params as any).id, me.username);
      await audit(me.username, 'config.backup', (req.params as any).id, {}, req.ip);
      return reply.code(201).send(backup);
    });

  // Diff two backups (or a backup against live running config)
  app.get('/api/devices/:id/diff', {
    preHandler: requireRole('readonly'),
    schema: {
      tags: ['configs'],
      querystring: {
        type: 'object', required: ['from'],
        properties: {
          from: { type: 'string', description: 'backup id' },
          to: { type: 'string', description: 'backup id, or "live" (default)' }
        }
      }
    }
  }, async (req, reply) => {
    const { id } = req.params as any;
    const { from, to } = req.query as any;
    const a = await query('SELECT content, created_at FROM config_backups WHERE id=$1 AND device_id=$2', [from, id]);
    if (!a.rows[0]) return reply.code(404).send({ error: 'from backup not found' });

    let bContent: string, bLabel: string;
    if (!to || to === 'live') {
      const out = await deviceExec(id, ['show running-config']);
      bContent = Object.values(out)[0] ?? '';
      bLabel = 'live running-config';
    } else {
      const b = await query('SELECT content, created_at FROM config_backups WHERE id=$1 AND device_id=$2', [to, id]);
      if (!b.rows[0]) return reply.code(404).send({ error: 'to backup not found' });
      bContent = b.rows[0].content;
      bLabel = `backup ${b.rows[0].created_at}`;
    }
    const patch = createTwoFilesPatch(
      `backup ${a.rows[0].created_at}`, bLabel, a.rows[0].content, bContent, '', '', { context: 3 });
    return { diff: patch, identical: patch.split('\n').length <= 5 };
  });

  // Git commit history for a device's config file
  app.get('/api/devices/:id/config/git-log', { preHandler: requireRole('readonly'), schema: { tags: ['configs'] } },
    async (req) => {
      const { id } = req.params as any;
      const { rows } = await query('SELECT hostname FROM devices WHERE id=$1', [id]);
      if (!rows[0]) return [];
      return gitLog(rows[0].hostname);
    });

  // Show config content at a specific git SHA
  app.get('/api/devices/:id/config/git-show/:sha', { preHandler: requireRole('readonly'), schema: { tags: ['configs'] } },
    async (req, reply) => {
      const { id, sha } = req.params as any;
      const { rows } = await query('SELECT hostname FROM devices WHERE id=$1', [id]);
      if (!rows[0]) return reply.code(404).send({ error: 'Device not found' });
      const content = await gitShow(sha, rows[0].hostname);
      if (!content) return reply.code(404).send({ error: 'Commit not found' });
      return { sha, content };
    });

  // Push arbitrary config lines (netadmin only)
  app.post('/api/devices/:id/config/push', {
    preHandler: requireRole('netadmin'),
    schema: {
      tags: ['configs'],
      body: {
        type: 'object', required: ['lines'],
        properties: {
          lines: { type: 'array', items: { type: 'string' }, minItems: 1 },
          save: { type: 'boolean', default: true }
        }
      }
    }
  }, async (req) => {
    const { id } = req.params as any;
    const { lines, save } = req.body as any;
    const me = req.user as any;
    // backup before change so every push is reversible
    await backupDevice(id, `${me.username} (pre-change)`);
    const output = await devicePushConfig(id, lines, save ?? true);
    await audit(me.username, 'config.push', id, { lines }, req.ip);
    return { ok: true, output };
  });

  // Restore a backup: replays the backup config via configure terminal.
  app.post('/api/devices/:id/restore/:backupId', { preHandler: requireRole('netadmin'), schema: { tags: ['configs'] } },
    async (req, reply) => {
      const { id, backupId } = req.params as any;
      const me = req.user as any;
      const { rows } = await query('SELECT content FROM config_backups WHERE id=$1 AND device_id=$2', [backupId, id]);
      if (!rows[0]) return reply.code(404).send({ error: 'Backup not found' });
      await backupDevice(id, `${me.username} (pre-restore)`);
      const lines = rows[0].content.split('\n')
        .filter((l: string) => l.trim() && !l.startsWith('!') && !/^(version|Building configuration|Current configuration)/.test(l));
      const output = await devicePushConfig(id, lines, true);
      await audit(me.username, 'config.restore', id, { backupId }, req.ip);
      return { ok: true, output };
    });

  // Baseline management for drift detection
  app.put('/api/devices/:id/baseline', {
    preHandler: requireRole('netadmin'),
    schema: {
      tags: ['configs'],
      body: {
        type: 'object', required: ['backupId'],
        properties: { backupId: { type: 'string' }, autoRemediate: { type: 'boolean', default: false } }
      }
    }
  }, async (req) => {
    const { id } = req.params as any;
    const { backupId, autoRemediate } = req.body as any;
    const me = req.user as any;
    await query(
      `INSERT INTO config_baselines (device_id, backup_id, auto_remediate, set_by)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (device_id) DO UPDATE SET backup_id=$2, auto_remediate=$3, set_by=$4, set_at=now()`,
      [id, backupId, autoRemediate ?? false, me.username]);
    await audit(me.username, 'config.baseline.set', id, { backupId, autoRemediate }, req.ip);
    return { ok: true };
  });

  app.get('/api/devices/:id/baseline', { preHandler: requireRole('readonly'), schema: { tags: ['configs'] } },
    async (req) => {
      const { rows } = await query('SELECT * FROM config_baselines WHERE device_id=$1', [(req.params as any).id]);
      return rows[0] ?? null;
    });
}

export function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}
