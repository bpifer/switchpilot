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

// A JWT is stateless for its whole (8h) life, so disabling a user, demoting a
// role, or resetting a stolen password must be enforced HERE, not just at the
// next login. Each verified JWT is checked against the live user row: still
// enabled, current role (the live one wins over the claim), and issued after
// users.token_valid_after. A short cache keeps this from adding a DB query to
// every request; bustAuthCache() makes in-process revocation immediate, and
// other replicas converge within the TTL.
const AUTH_CACHE_TTL_MS = 30_000;
interface LiveUser { role: Role; enabled: boolean; token_valid_after: Date | null; }
const authCache = new Map<string, { at: number; row: LiveUser | null }>();

export function bustAuthCache(userId?: string): void {
  if (userId) authCache.delete(userId);
  else authCache.clear();
}

async function liveUser(userId: string): Promise<LiveUser | null> {
  const hit = authCache.get(userId);
  if (hit && Date.now() - hit.at < AUTH_CACHE_TTL_MS) return hit.row;
  const { rows } = await query<LiveUser>(
    'SELECT role, enabled, token_valid_after FROM users WHERE id=$1', [userId]);
  const row = rows[0] ?? null;
  authCache.set(userId, { at: Date.now(), row });
  return row;
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
      if (user) {
        const fresh = await liveUser(user.sub);
        if (!fresh || !fresh.enabled) {
          return reply.code(401).send({ error: 'Account disabled' });
        }
        // iat is whole seconds; compare at second resolution so a token minted
        // in the same second as the cutoff (e.g. right after a password
        // change) isn't spuriously revoked.
        const iat = (req.user as any).iat as number | undefined;
        if (fresh.token_valid_after && iat !== undefined &&
            iat < Math.floor(new Date(fresh.token_valid_after).getTime() / 1000)) {
          return reply.code(401).send({ error: 'Session revoked - log in again' });
        }
        user.role = fresh.role;   // live role wins over the (stale) claim
      }
    }
    if (!user) {
      return reply.code(401).send({ error: 'Authentication required' });
    }
    if (!hasRole(user, minimum)) {
      return reply.code(403).send({ error: `Requires ${minimum} role or higher` });
    }
  };
}
