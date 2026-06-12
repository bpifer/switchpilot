import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { authenticator } from 'otplib';
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
  const { migrate, seedAdmin } = await import('../src/db.js');
  await migrate();
  await seedAdmin();
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

describe('token refresh', () => {
  itDb('a valid token can be exchanged for a fresh one', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/refresh', headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(res.statusCode).toBe(200);
    const fresh = res.json().token;
    expect(fresh).toBeTruthy();
    // the fresh token works for authenticated calls
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${fresh}` } });
    expect(me.statusCode).toBe(200);
  });

  itDb('refresh without a token is 401', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/auth/refresh' })).statusCode).toBe(401);
  });

  itDb('issues a short-lived ws nonce distinct from the session token', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/ws-token', headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(res.statusCode).toBe(200);
    const nonce = res.json().token;
    expect(nonce).toBeTruthy();
    expect(nonce).not.toBe(adminToken);
    // the nonce carries the ws claim and a short expiry
    const payload = JSON.parse(Buffer.from(nonce.split('.')[1], 'base64url').toString());
    expect(payload.ws).toBe(true);
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(30);
  });
});

describe('MFA enrollment, login, and backup codes', () => {
  const PW = 'MfaUserPass123';
  let userToken = '';
  let secret = '';
  let backupCodes: string[] = [];

  itDb('full cycle: enroll, TOTP login, backup-code login (single use)', async () => {
    // create a user and log in
    const created = await app.inject({
      method: 'POST', url: '/api/users',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
      payload: JSON.stringify({ username: 'mfa_test', role: 'helpdesk', password: PW, authSource: 'local' })
    });
    expect(created.statusCode).toBe(201);
    userToken = (await login('mfa_test', PW, '10.0.1.1')).json().token;

    // enroll: setup returns the secret, confirm with a real TOTP code
    const setup = await app.inject({
      method: 'POST', url: '/api/auth/mfa/setup', headers: { authorization: `Bearer ${userToken}` }
    });
    expect(setup.statusCode).toBe(200);
    secret = setup.json().secret;

    const confirm = await app.inject({
      method: 'POST', url: '/api/auth/mfa/confirm',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${userToken}` },
      payload: JSON.stringify({ totp: authenticator.generate(secret) })
    });
    expect(confirm.statusCode).toBe(200);
    backupCodes = confirm.json().backupCodes;
    expect(backupCodes).toHaveLength(8);

    // password alone is no longer enough
    const noMfa = await login('mfa_test', PW, '10.0.1.2');
    expect(noMfa.statusCode).toBe(401);
    expect(noMfa.json().mfaRequired).toBe(true);

    // TOTP works
    const totpLogin = await app.inject({
      method: 'POST', url: '/api/auth/login', remoteAddress: '10.0.1.3',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ username: 'mfa_test', password: PW, totp: authenticator.generate(secret) })
    });
    expect(totpLogin.statusCode).toBe(200);

    // a backup code works in place of TOTP
    const code = backupCodes[0];
    const backupLogin = await app.inject({
      method: 'POST', url: '/api/auth/login', remoteAddress: '10.0.1.4',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ username: 'mfa_test', password: PW, totp: code })
    });
    expect(backupLogin.statusCode).toBe(200);

    // but only once
    const reuse = await app.inject({
      method: 'POST', url: '/api/auth/login', remoteAddress: '10.0.1.5',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ username: 'mfa_test', password: PW, totp: code })
    });
    expect(reuse.statusCode).toBe(401);
  }, 30000);
});
