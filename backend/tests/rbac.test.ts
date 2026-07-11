import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db.js', () => ({ query: vi.fn() }));
import { query } from '../src/db.js';
import { hasRole, requireRole, bustAuthCache, type AuthUser } from '../src/auth/rbac.js';

const user = (role: AuthUser['role']): AuthUser => ({ sub: 'x', username: 'test', role });

describe('RBAC hierarchy', () => {
  it('superadmin can do everything', () => {
    for (const min of ['superadmin', 'netadmin', 'helpdesk', 'readonly'] as const) {
      expect(hasRole(user('superadmin'), min)).toBe(true);
    }
  });

  it('netadmin cannot act as superadmin', () => {
    expect(hasRole(user('netadmin'), 'superadmin')).toBe(false);
    expect(hasRole(user('netadmin'), 'netadmin')).toBe(true);
    expect(hasRole(user('netadmin'), 'helpdesk')).toBe(true);
  });

  it('helpdesk can operate but not configure', () => {
    expect(hasRole(user('helpdesk'), 'netadmin')).toBe(false);
    expect(hasRole(user('helpdesk'), 'helpdesk')).toBe(true);
  });

  it('readonly can only read', () => {
    expect(hasRole(user('readonly'), 'helpdesk')).toBe(false);
    expect(hasRole(user('readonly'), 'readonly')).toBe(true);
  });
});

// requireRole's JWT branch re-checks the live user row so revocation, disable,
// and demotion apply mid-token, not at the 8h expiry.
describe('requireRole session revocation', () => {
  const mockQuery = query as unknown as ReturnType<typeof vi.fn>;

  function makeReq(claims: Record<string, unknown>) {
    return {
      headers: {},
      user: claims,
      jwtVerify: async () => { /* claims already on req.user */ },
    } as any;
  }
  function makeReply() {
    const r: any = { status: 200, body: null };
    r.code = (s: number) => { r.status = s; return r; };
    r.send = (b: unknown) => { r.body = b; return r; };
    return r;
  }
  const dbUser = (row: Record<string, unknown> | null) =>
    mockQuery.mockResolvedValue({ rows: row ? [row] : [] });

  beforeEach(() => {
    mockQuery.mockReset();
    bustAuthCache();
  });

  it('rejects a token issued before token_valid_after', async () => {
    dbUser({ role: 'superadmin', enabled: true, token_valid_after: new Date('2026-07-10T12:00:00Z') });
    const reply = makeReply();
    await requireRole('readonly')(
      makeReq({ sub: 'u1', username: 'a', role: 'superadmin', iat: Math.floor(Date.parse('2026-07-10T11:00:00Z') / 1000) }),
      reply);
    expect(reply.status).toBe(401);
    expect(reply.body.error).toMatch(/revoked/i);
  });

  it('accepts a token issued after the cutoff', async () => {
    dbUser({ role: 'netadmin', enabled: true, token_valid_after: new Date('2026-07-10T12:00:00Z') });
    const reply = makeReply();
    await requireRole('netadmin')(
      makeReq({ sub: 'u1', username: 'a', role: 'netadmin', iat: Math.floor(Date.parse('2026-07-10T13:00:00Z') / 1000) }),
      reply);
    expect(reply.status).toBe(200);   // untouched = allowed through
  });

  it('rejects a disabled account even with a valid token', async () => {
    dbUser({ role: 'superadmin', enabled: false, token_valid_after: null });
    const reply = makeReply();
    await requireRole('readonly')(
      makeReq({ sub: 'u1', username: 'a', role: 'superadmin', iat: 1 }), reply);
    expect(reply.status).toBe(401);
    expect(reply.body.error).toMatch(/disabled/i);
  });

  it('enforces the LIVE role, not the stale token claim (demotion mid-token)', async () => {
    dbUser({ role: 'readonly', enabled: true, token_valid_after: null });
    const reply = makeReply();
    const req = makeReq({ sub: 'u1', username: 'a', role: 'superadmin', iat: 1 });
    await requireRole('netadmin')(req, reply);
    expect(reply.status).toBe(403);   // token says superadmin; DB says readonly
  });

  it('caches the live row and bustAuthCache forces a re-read', async () => {
    dbUser({ role: 'netadmin', enabled: true, token_valid_after: null });
    const mk = () => makeReq({ sub: 'u1', username: 'a', role: 'netadmin', iat: 1 });
    await requireRole('readonly')(mk(), makeReply());
    await requireRole('readonly')(mk(), makeReply());
    expect(mockQuery).toHaveBeenCalledTimes(1);   // second hit served from cache
    bustAuthCache('u1');
    await requireRole('readonly')(mk(), makeReply());
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});
