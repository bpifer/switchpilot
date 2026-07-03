import path from 'node:path';
import os from 'node:os';
import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { audit, verifyAuditChain } from '../audit.js';
import { requireRole } from '../auth/rbac.js';
import { getPolicy, invalidatePolicyCache } from '../auth/securityPolicy.js';
import { pgDumpStream, restoreDump, dumpFilename } from '../services/dbBackup.js';

export default async function securityRoutes(app: FastifyInstance) {
  // Read the org security policy
  app.get('/api/security/policy', { preHandler: requireRole('superadmin'), schema: { tags: ['security'] } },
    async () => getPolicy());

  // Update the org security policy
  app.put('/api/security/policy', {
    preHandler: requireRole('superadmin'),
    schema: {
      tags: ['security'],
      body: {
        type: 'object',
        properties: {
          password_min_length:     { type: 'integer', minimum: 8, maximum: 128 },
          password_require_upper:  { type: 'boolean' },
          password_require_lower:  { type: 'boolean' },
          password_require_digit:  { type: 'boolean' },
          password_require_symbol: { type: 'boolean' },
          password_max_age_days:   { type: 'integer', minimum: 0, maximum: 3650 },
          mfa_required:            { type: 'boolean' },
          mfa_required_roles:      { type: 'array', items: { type: 'string', enum: ['superadmin', 'netadmin', 'helpdesk', 'readonly'] } },
          lockout_threshold:       { type: 'integer', minimum: 0, maximum: 100 },
          lockout_minutes:         { type: 'integer', minimum: 1, maximum: 1440 }
        }
      }
    }
  }, async (req) => {
    const me = req.user as any;
    const b = req.body as any;
    // Only update provided fields (COALESCE keeps existing values for omitted keys).
    await query(
      `UPDATE security_settings SET
         password_min_length     = COALESCE($1, password_min_length),
         password_require_upper  = COALESCE($2, password_require_upper),
         password_require_lower  = COALESCE($3, password_require_lower),
         password_require_digit  = COALESCE($4, password_require_digit),
         password_require_symbol = COALESCE($5, password_require_symbol),
         password_max_age_days   = COALESCE($6, password_max_age_days),
         mfa_required            = COALESCE($7, mfa_required),
         mfa_required_roles      = COALESCE($8, mfa_required_roles),
         lockout_threshold       = COALESCE($9, lockout_threshold),
         lockout_minutes         = COALESCE($10, lockout_minutes),
         updated_by = $11, updated_at = now()
       WHERE id = 1`,
      [b.password_min_length ?? null, b.password_require_upper ?? null, b.password_require_lower ?? null,
       b.password_require_digit ?? null, b.password_require_symbol ?? null, b.password_max_age_days ?? null,
       b.mfa_required ?? null, b.mfa_required_roles ?? null, b.lockout_threshold ?? null,
       b.lockout_minutes ?? null, me.username]);
    invalidatePolicyCache();
    await audit(me.username, 'security.policy.update', '', b, req.ip);
    return getPolicy();
  });

  // Verify the tamper-evident audit log hash chain
  app.get('/api/security/audit/verify', { preHandler: requireRole('superadmin'), schema: { tags: ['security'] } },
    async () => verifyAuditChain());

  // ----- Disaster recovery: full-database backup / restore (superadmin) -----

  // Stream a pg_dump of the whole database as a download (DR backup).
  app.get('/api/security/db/backup', { preHandler: requireRole('superadmin'), schema: { tags: ['security'] } },
    async (req, reply) => {
      const me = req.user as any;
      await audit(me.username, 'db.backup.download', '', {}, req.ip);
      const { stream, done } = pgDumpStream();
      // A pg_dump failure mid-stream can't un-send headers; destroy the response
      // so the client sees a truncated download rather than a silent bad file.
      done.catch(err => { req.log.error(`db backup failed: ${err.message}`); stream.destroy(err); });
      reply.header('Content-Type', 'application/octet-stream');
      reply.header('Content-Disposition', `attachment; filename="${dumpFilename()}"`);
      return reply.send(stream);
    });

  // Restore the database from an uploaded pg_dump. DESTRUCTIVE: replaces all
  // data. Requires confirm=RESTORE, takes a safety dump first, and is audited.
  app.post('/api/security/db/restore', { preHandler: requireRole('superadmin'), schema: { tags: ['security'], consumes: ['multipart/form-data'] } },
    async (req, reply) => {
      const me = req.user as any;
      const data = await (req as any).file({ limits: { fileSize: 2 * 1024 * 1024 * 1024 } });
      if (!data) return reply.code(400).send({ error: 'No backup file uploaded' });
      // The confirm field must precede the file part in the multipart body.
      const confirm = (data.fields?.confirm?.value ?? '') as string;
      if (confirm !== 'RESTORE') {
        return reply.code(400).send({ error: 'Restore not confirmed. Send confirm="RESTORE".' });
      }
      const tmp = path.join(os.tmpdir(), `sp-restore-${Date.now()}.dump`);
      await pipeline(data.file, createWriteStream(tmp));
      try {
        const result = await restoreDump(tmp);
        await audit(me.username, 'db.restore', '',
          { safetyBackup: result.safetyBackupPath, log: result.log.slice(0, 2000) }, req.ip);
        return {
          ok: true,
          safetyBackup: result.safetyBackupPath,
          log: result.log,
          note: 'Restore applied. Restart the API container so all services pick up the restored data cleanly.',
        };
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      } finally {
        await unlink(tmp).catch(() => {});
      }
    });

  // Unlock a locked-out user account
  app.post('/api/security/unlock/:id', { preHandler: requireRole('superadmin'), schema: { tags: ['security'] } },
    async (req) => {
      const me = req.user as any;
      const { id } = req.params as any;
      await query('UPDATE users SET failed_login_count=0, locked_until=NULL WHERE id=$1', [id]);
      await audit(me.username, 'security.account.unlock', id, {}, req.ip);
      return { ok: true };
    });
}
