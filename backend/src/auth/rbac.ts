import type { FastifyReply, FastifyRequest } from 'fastify';

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

/** Fastify preHandler: require a valid JWT with at least the given role. */
export function requireRole(minimum: Role) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'Authentication required' });
    }
    const user = req.user as AuthUser;
    if (!hasRole(user, minimum)) {
      return reply.code(403).send({ error: `Requires ${minimum} role or higher` });
    }
  };
}
