import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';

// HTTP-level tests that boot the real app and drive it with Fastify `inject`.
// They need a Postgres instance, so they only run when RUN_DB_TESTS=1 (set in
// CI alongside a postgres service). Locally without a DB they're skipped.
const RUN = !!process.env.RUN_DB_TESTS;
const itDb = RUN ? it : it.skip;

let app: FastifyInstance;
let adminToken = '';

const login = (username: string, password: string, ip: string) =>
  app.inject({
    method: 'POST', url: '/api/auth/login', remoteAddress: ip,
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ username, password })
  });

beforeAll(async () => {
  if (!RUN) return;
  const { buildApp } = await import('../src/app.js');
  app = await buildApp();
  const res = await login('admin', 'ChangeMe123!', '10.0.0.1');
  adminToken = res.json().token;
}, 40000);

afterAll(async () => { if (RUN) await app?.close(); });

describe('system endpoints', () => {
  itDb('GET /api/health reports db + redis', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().db).toBe('ok');
  });

  itDb('GET /metrics returns Prometheus exposition', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('switchpilot_');
    expect(res.body).toContain('switchpilot_http_request_duration_seconds');
  });

  itDb('GET /api/summary requires auth', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/summary' })).statusCode).toBe(401);
  });
});

describe('authentication', () => {
  itDb('rejects wrong credentials with 401', async () => {
    const res = await login('admin', 'wrong-password', '10.0.0.2');
    expect(res.statusCode).toBe(401);
  });

  itDb('accepts the seeded admin and flags the forced password change', async () => {
    const res = await login('admin', 'ChangeMe123!', '10.0.0.3');
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeTruthy();
    expect(res.json().user.mustChangePassword).toBe(true);
  });

  itDb('throttles brute-force login attempts (429 after the limit)', async () => {
    const ip = '10.9.9.9';
    let throttled = false;
    for (let i = 0; i < 15; i++) {
      const res = await login('admin', 'nope', ip);
      if (res.statusCode === 429) { throttled = true; break; }
    }
    expect(throttled).toBe(true);
  });
});

describe('RBAC enforcement', () => {
  itDb('readonly user can read devices but not create them', async () => {
    // superadmin creates a readonly account
    const created = await app.inject({
      method: 'POST', url: '/api/users',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
      payload: JSON.stringify({ username: 'ro_test', role: 'readonly', password: 'ReadOnlyPass123', authSource: 'local' })
    });
    expect(created.statusCode).toBe(201);

    const ro = (await login('ro_test', 'ReadOnlyPass123', '10.0.0.4')).json().token;

    const read = await app.inject({
      method: 'GET', url: '/api/devices', headers: { authorization: `Bearer ${ro}` }
    });
    expect(read.statusCode).toBe(200);

    const write = await app.inject({
      method: 'POST', url: '/api/devices',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ro}` },
      payload: JSON.stringify({ mgmtIp: '10.10.10.10', credentialId: '00000000-0000-0000-0000-000000000000' })
    });
    expect(write.statusCode).toBe(403);
  });

  itDb('unauthenticated device write is 401', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/devices',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ mgmtIp: '10.10.10.11', credentialId: '00000000-0000-0000-0000-000000000000' })
    });
    expect(res.statusCode).toBe(401);
  });
});
