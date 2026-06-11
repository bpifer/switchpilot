import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { audit, verifyAuditChain } from '../audit.js';
import { requireRole } from '../auth/rbac.js';
import { getPolicy, invalidatePolicyCache } from '../auth/securityPolicy.js';

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
