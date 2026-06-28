import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { createTwoFilesPatch } from 'diff';
import { query } from '../db.js';
import { audit, redactForAudit } from '../audit.js';
import { requireRole } from '../auth/rbac.js';
import { deviceExec, devicePushConfig, setLoggingLevel, getDevice } from '../services/deviceComms.js';
import { driverFor } from '../drivers/index.js';
import { isMikrotik } from '../services/routerosMonitor.js';

// A RouterOS /export is not replayable line-by-line (section headers + `add`
// lines need /import), so block restore/rollback rather than half-apply it.
const ROUTEROS_RESTORE_MSG = 'Config restore/rollback is not supported on RouterOS yet: a /export cannot be replayed line by line. Use /import on the device.';
import { backupDevice } from '../services/configService.js';
import { gitLog, gitShow, gitDiff } from '../services/configVersioning.js';
import { previewConfigLines, detectMgmtLockout } from '../services/configPreview.js';

/** Fetch hostname + site name for a device, for git path resolution. */
async function deviceGitContext(id: string): Promise<{ hostname: string; site: string | null } | null> {
  const { rows } = await query(
    `SELECT d.hostname, s.name AS site_name
       FROM devices d LEFT JOIN sites s ON s.id = d.site_id WHERE d.id=$1`, [id]);
  if (!rows[0]) return null;
  return { hostname: rows[0].hostname, site: rows[0].site_name ?? null };
}

export default async function configRoutes(app: FastifyInstance) {
  /**
   * Dry run: classify proposed config lines against the device's LIVE running
   * config without changing anything. Not a semantic diff - a line-presence
   * check that catches "already configured" and shows exactly what is new.
   */
  app.post('/api/devices/:id/config/preview', {
    preHandler: requireRole('helpdesk'),
    schema: {
      tags: ['configs'],
      body: {
        type: 'object', required: ['lines'],
        properties: { lines: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 500 } }
      }
    }
  }, async (req) => {
    const { id } = req.params as any;
    const { lines } = req.body as { lines: string[] };
    return previewConfigLines(id, lines);
  });

  // Set the syslog trap level (which severities are forwarded to the collector)
  app.post('/api/devices/:id/logging-level', {
    preHandler: requireRole('netadmin'),
    schema: {
      tags: ['configs'],
      body: {
        type: 'object', required: ['level'],
        properties: {
          level: {
            type: 'string',
            enum: ['emergencies', 'alerts', 'critical', 'errors', 'warnings',
                   'notifications', 'informational', 'debugging']
          }
        }
      }
    }
  }, async (req) => {
    const { id } = req.params as any;
    const { level } = req.body as any;
    const me = req.user as any;
    const output = await setLoggingLevel(id, level);
    await audit(me.username, 'device.logging_level', id, { level, output: redactForAudit(output) }, req.ip);
    return { ok: true, output };
  });

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
    const drv = driverFor(await getDevice(id));
    // RouterOS has no separate startup config; its export is the live config.
    const cmd = (kind === 'startup' && drv.os !== 'routeros') ? 'show startup-config' : drv.configCommand;
    const out = await deviceExec(id, [cmd]);
    return { kind, content: Object.values(out)[0] ?? '' };
  });

  // Backups
  app.get('/api/devices/:id/backups', { preHandler: requireRole('readonly'), schema: { tags: ['configs'] } },
    async (req) => {
      const { rows } = await query(
        `SELECT id, kind, sha256, taken_by, reason, ticket, git_sha, created_at, length(content) AS size
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

  // Fleet backup: every device's latest config backup as one downloadable text
  // file. netadmin-only (Cisco running-config can contain secrets) and audited.
  app.get('/api/config-bundle', { preHandler: requireRole('netadmin'), schema: { tags: ['configs'] } },
    async (req, reply) => {
      const me = req.user as any;
      const { rows } = await query<{ hostname: string; mgmt_ip: string; content: string; created_at: string }>(`
        SELECT DISTINCT ON (cb.device_id) d.hostname, host(d.mgmt_ip) AS mgmt_ip, cb.content, cb.created_at
        FROM config_backups cb JOIN devices d ON d.id = cb.device_id
        ORDER BY cb.device_id, cb.created_at DESC`);
      const body = rows.map(r =>
        `# ===== ${r.hostname || r.mgmt_ip} (${r.mgmt_ip}) - backed up ${new Date(r.created_at).toISOString()} =====\n${r.content}\n`
      ).join('\n');
      await audit(me.username, 'config.bundle.download', '', { devices: rows.length }, req.ip);
      reply.header('content-type', 'text/plain; charset=utf-8');
      reply.header('content-disposition', `attachment; filename="switchpilot-configs-${new Date().toISOString().slice(0, 10)}.txt"`);
      return body || '# No config backups yet.\n';
    });

  app.post('/api/devices/:id/backups', {
    preHandler: requireRole('helpdesk'),
    schema: {
      tags: ['configs'],
      body: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Why this backup is being taken' },
          ticket: { type: 'string', description: 'Change ticket reference' }
        }
      }
    }
  }, async (req, reply) => {
    const me = req.user as any;
    const { reason, ticket } = (req.body as any) ?? {};
    const backup = await backupDevice((req.params as any).id, me.username, { reason, ticket });
    await audit(me.username, 'config.backup', (req.params as any).id, { reason, ticket }, req.ip);
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
      const out = await deviceExec(id, [driverFor(await getDevice(id)).configCommand]);
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
      const ctx = await deviceGitContext((req.params as any).id);
      if (!ctx) return [];
      return gitLog(ctx.hostname, ctx.site);
    });

  // Show config content at a specific git SHA
  app.get('/api/devices/:id/config/git-show/:sha', { preHandler: requireRole('readonly'), schema: { tags: ['configs'] } },
    async (req, reply) => {
      const { id, sha } = req.params as any;
      const ctx = await deviceGitContext(id);
      if (!ctx) return reply.code(404).send({ error: 'Device not found' });
      const content = await gitShow(sha, ctx.hostname, ctx.site);
      if (!content) return reply.code(404).send({ error: 'Commit not found' });
      return { sha, content };
    });

  // Diff a device's config between two commits (git history)
  app.get('/api/devices/:id/config/git-diff', {
    preHandler: requireRole('readonly'),
    schema: {
      tags: ['configs'],
      querystring: {
        type: 'object', required: ['from'],
        properties: {
          from: { type: 'string', description: 'commit SHA' },
          to: { type: 'string', description: 'commit SHA (default HEAD)' }
        }
      }
    }
  }, async (req, reply) => {
    const { id } = req.params as any;
    const { from, to } = req.query as any;
    const ctx = await deviceGitContext(id);
    if (!ctx) return reply.code(404).send({ error: 'Device not found' });
    const diff = await gitDiff(ctx.hostname, ctx.site, from, to || 'HEAD');
    if (diff === null) return reply.code(404).send({ error: 'Commit not found' });
    return { diff, identical: !diff.trim() };
  });

  // Roll back to a specific git commit: replay that historical config onto the device.
  app.post('/api/devices/:id/config/rollback/:sha', { preHandler: requireRole('netadmin'), schema: { tags: ['configs'] } },
    async (req, reply) => {
      const { id, sha } = req.params as any;
      const me = req.user as any;
      if (isMikrotik(await getDevice(id))) return reply.code(400).send({ error: ROUTEROS_RESTORE_MSG });
      const ctx = await deviceGitContext(id);
      if (!ctx) return reply.code(404).send({ error: 'Device not found' });
      const content = await gitShow(sha, ctx.hostname, ctx.site);
      if (!content) return reply.code(404).send({ error: 'Commit not found' });
      // snapshot current state first so the rollback is itself reversible
      await backupDevice(id, me.username, { reason: `pre-rollback to ${sha.slice(0, 8)}` });
      const lines = content.split('\n')
        .filter((l: string) => l.trim() && !l.startsWith('!') && !/^(version|Building configuration|Current configuration)/.test(l));
      const output = await devicePushConfig(id, lines, true);
      await audit(me.username, 'config.rollback', id, { sha, output: redactForAudit(output) }, req.ip);
      return { ok: true, output };
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
          save: { type: 'boolean', default: true },
          force: { type: 'boolean', default: false }
        }
      }
    }
  }, async (req, reply) => {
    const { id } = req.params as any;
    const { lines, save, force } = req.body as any;
    const me = req.user as any;

    // Server-side self-lockout gate: refuse a push that looks like it would cut
    // SwitchPilot's own SSH path (SSH disable, VTY transport/ACL, /system reset,
    // mgmt firewall drop, account removal) unless explicitly forced. This is the
    // enforcement the preview's advisory warnings always implied; vendor-aware.
    const lockout = detectMgmtLockout(lines, driverFor(await getDevice(id)).vendor);
    if (lockout.length && !force) {
      await audit(me.username, 'config.push.blocked', id, { lines, warnings: lockout }, req.ip);
      return reply.code(409).send({
        error: 'Refused: this push looks like it would lock SwitchPilot out of the device.',
        detail: { warnings: lockout, hint: 'Re-send with "force": true to push anyway.' }
      });
    }

    // backup before change so every push is reversible
    await backupDevice(id, `${me.username} (pre-change)`);
    const output = await devicePushConfig(id, lines, save ?? true);
    await audit(me.username, 'config.push', id,
      { lines, output: redactForAudit(output), ...(lockout.length ? { forcedLockout: lockout } : {}) }, req.ip);
    return { ok: true, output };
  });

  // Restore a backup: replays the backup config via configure terminal.
  app.post('/api/devices/:id/restore/:backupId', { preHandler: requireRole('netadmin'), schema: { tags: ['configs'] } },
    async (req, reply) => {
      const { id, backupId } = req.params as any;
      const me = req.user as any;
      if (isMikrotik(await getDevice(id))) return reply.code(400).send({ error: ROUTEROS_RESTORE_MSG });
      const { rows } = await query('SELECT content FROM config_backups WHERE id=$1 AND device_id=$2', [backupId, id]);
      if (!rows[0]) return reply.code(404).send({ error: 'Backup not found' });
      await backupDevice(id, `${me.username} (pre-restore)`);
      const lines = rows[0].content.split('\n')
        .filter((l: string) => l.trim() && !l.startsWith('!') && !/^(version|Building configuration|Current configuration)/.test(l));
      const output = await devicePushConfig(id, lines, true);
      await audit(me.username, 'config.restore', id, { backupId, output: redactForAudit(output) }, req.ip);
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
