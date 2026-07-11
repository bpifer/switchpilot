import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { query } from '../db.js';
import { audit } from '../audit.js';
import { requireRole, bustAuthCache } from '../auth/rbac.js';
import { assertPasswordAllowed } from '../auth/securityPolicy.js';

export default async function userRoutes(app: FastifyInstance) {
  app.get('/api/users', { preHandler: requireRole('superadmin'), schema: { tags: ['users'] } },
    async () => {
      const { rows } = await query(
        `SELECT id, username, display_name, email, auth_source, role, mfa_enabled, enabled,
                created_at, last_login_at, failed_login_count,
                (locked_until IS NOT NULL AND locked_until > now()) AS locked
         FROM users ORDER BY username`);
      return rows;
    });

  app.post('/api/users', {
    preHandler: requireRole('superadmin'),
    schema: {
      tags: ['users'],
      body: {
        type: 'object', required: ['username', 'role'],
        properties: {
          username: { type: 'string', minLength: 2 },
          displayName: { type: 'string' },
          email: { type: 'string' },
          role: { type: 'string', enum: ['superadmin', 'netadmin', 'helpdesk', 'readonly'] },
          password: { type: 'string', minLength: 12 },
          authSource: { type: 'string', enum: ['local', 'ldap'], default: 'local' }
        }
      }
    }
  }, async (req, reply) => {
    const b = req.body as any;
    const me = req.user as any;
    if (b.authSource !== 'ldap') {
      if (!b.password) return reply.code(400).send({ error: 'Password required for local accounts' });
      try { await assertPasswordAllowed(b.password); }
      catch (err: any) { return reply.code(400).send({ error: err.message }); }
    }
    const hash = b.authSource !== 'ldap' && b.password ? await bcrypt.hash(b.password, 12) : null;
    const { rows } = await query(
      `INSERT INTO users (username, display_name, email, role, password_hash, auth_source, must_change_password)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, username, role`,
      [b.username, b.displayName ?? b.username, b.email ?? null, b.role, hash, b.authSource ?? 'local', b.authSource !== 'ldap']);
    await audit(me.username, 'user.create', b.username, { role: b.role }, req.ip);
    return reply.code(201).send(rows[0]);
  });

  app.patch('/api/users/:id', {
    preHandler: requireRole('superadmin'),
    schema: {
      tags: ['users'],
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ['superadmin', 'netadmin', 'helpdesk', 'readonly'] },
          enabled: { type: 'boolean' },
          displayName: { type: 'string' },
          password: { type: 'string', minLength: 12 }
        }
      }
    }
  }, async (req, reply) => {
    const { id } = req.params as any;
    const b = req.body as any;
    const me = req.user as any;
    if (b.role !== undefined) await query('UPDATE users SET role=$1 WHERE id=$2', [b.role, id]);
    if (b.enabled !== undefined) await query('UPDATE users SET enabled=$1 WHERE id=$2', [b.enabled, id]);
    if (b.displayName !== undefined) await query('UPDATE users SET display_name=$1 WHERE id=$2', [b.displayName, id]);
    if (b.password) {
      try { await assertPasswordAllowed(b.password); }
      catch (err: any) { return reply.code(400).send({ error: err.message }); }
      const hash = await bcrypt.hash(b.password, 12);
      await query(`UPDATE users SET password_hash=$1, must_change_password=TRUE, password_changed_at=now() WHERE id=$2 AND auth_source='local'`, [hash, id]);
    }
    // Security-relevant changes take effect NOW, not when the target's 8h
    // token expires: outstanding sessions are revoked (password/disable) or
    // re-read the live role on their next request.
    if (b.role !== undefined || b.enabled === false || b.password) {
      await query('UPDATE users SET token_valid_after=now() WHERE id=$1', [id]);
    }
    bustAuthCache(id);
    await audit(me.username, 'user.update', id, b.password ? { ...b, password: '***' } : b, req.ip);
    return { ok: true };
  });

  app.delete('/api/users/:id', { preHandler: requireRole('superadmin'), schema: { tags: ['users'] } },
    async (req, reply) => {
      const { id } = req.params as any;
      const me = req.user as any;
      if (id === me.sub) return reply.code(400).send({ error: 'Cannot delete your own account' });
      await query('DELETE FROM users WHERE id=$1', [id]);
      await audit(me.username, 'user.delete', id, {}, req.ip);
      return { ok: true };
    });

  app.get('/api/audit', {
    preHandler: requireRole('superadmin'),
    schema: {
      tags: ['users'],
      querystring: {
        type: 'object',
        properties: { limit: { type: 'integer', default: 200 }, username: { type: 'string' }, action: { type: 'string' } }
      }
    }
  }, async (req) => {
    const q = req.query as any;
    const conds: string[] = [];
    const params: unknown[] = [];
    if (q.username) { params.push(q.username); conds.push(`username=$${params.length}`); }
    if (q.action) { params.push(`${q.action}%`); conds.push(`action LIKE $${params.length}`); }
    params.push(Math.min(q.limit ?? 200, 1000));
    const { rows } = await query(
      `SELECT * FROM audit_log ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
       ORDER BY created_at DESC LIMIT $${params.length}`, params);
    return rows;
  });
}
