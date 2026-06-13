import type { FastifyReply, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { query } from '../db.js';

export type Role = 'superadmin' | 'netadmin' | 'helpdesk' | 'readonly';

// Role hierarchy: each role implies everything below it.
const RANK: Record<Role, number> = { superadmin: 4, netadmin: 3, helpdesk: 2, readonly: 1 };

export interface AuthUser {
  sub: string;       // user id
  username: string;
  role: Role;
}

export function hasRole(user: AuthUser, minimum: Role): boolean {
  return RANK[user.role] >= RANK[minimum];
}

/**
 * API-key auth for programmatic access: `Authorization: Bearer sp_...`.
 * Returns the AuthUser or null. Keys are stored as sha256 hashes; the
 * username is `apikey:<name>` so audit entries identify the integration.
 */
async function verifyApiKey(req: FastifyRequest): Promise<AuthUser | null> {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer sp_')) return null;
  const token = header.slice('Bearer '.length);
  const hash = createHash('sha256').update(token).digest('hex');
  const { rows } = await query(
    'SELECT id, name, role FROM api_keys WHERE key_hash=$1 AND enabled', [hash]);
  if (!rows[0]) return null;
  query('UPDATE api_keys SET last_used_at=now() WHERE id=$1', [rows[0].id]).catch(() => {});
  return { sub: rows[0].id, username: `apikey:${rows[0].name}`, role: rows[0].role as Role };
}

/** Fastify preHandler: require a valid JWT or API key with at least the given role. */
export function requireRole(minimum: Role) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    let user: AuthUser | null = null;
    // sp_-prefixed bearer tokens are API keys, everything else is a JWT
    if ((req.headers.authorization ?? '').startsWith('Bearer sp_')) {
      user = await verifyApiKey(req);
      if (user) (req as any).user = user;
    } else {
      try {
        await req.jwtVerify();
        user = req.user as AuthUser;
      } catch { /* handled below */ }
    }
    if (!user) {
      return reply.code(401).send({ error: 'Authentication required' });
    }
    if (!hasRole(user, minimum)) {
      return reply.code(403).send({ error: `Requires ${minimum} role or higher` });
    }
  };
}
