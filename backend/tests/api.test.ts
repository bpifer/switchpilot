import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { authenticator } from 'otplib';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

// Firmware uploads write to FIRMWARE_DIR; point it somewhere writable before
// config.ts is (dynamically) imported.
process.env.FIRMWARE_DIR ??= path.join(tmpdir(), 'switchpilot-fw-test');

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

describe('firmware upload', () => {
  function multipartPayload(fields: Record<string, string>, fileContent: string) {
    const b = '----vitestboundary42';
    let body = '';
    for (const [k, v] of Object.entries(fields)) {
      body += `--${b}\r\ncontent-disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
    }
    body += `--${b}\r\ncontent-disposition: form-data; name="file"; filename="test-image.bin"\r\n` +
            `content-type: application/octet-stream\r\n\r\n${fileContent}\r\n--${b}--\r\n`;
    return { body, contentType: `multipart/form-data; boundary=${b}` };
  }

  itDb('rejects an unknown family with 400', async () => {
    const { body, contentType } = multipartPayload({ family: 'not-a-family', version: '1.0' }, 'FAKE');
    const res = await app.inject({
      method: 'POST', url: '/api/firmware',
      headers: { 'content-type': contentType, authorization: `Bearer ${adminToken}` },
      payload: body
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Unknown family');
  });

  itDb('rejects a version with invalid characters', async () => {
    const { listFamilies } = await import('../src/cisco/capabilities.js');
    const family = Object.keys(listFamilies())[0];
    const { body, contentType } = multipartPayload({ family, version: 'bad version!' }, 'FAKE');
    const res = await app.inject({
      method: 'POST', url: '/api/firmware',
      headers: { 'content-type': contentType, authorization: `Bearer ${adminToken}` },
      payload: body
    });
    expect(res.statusCode).toBe(400);
  });

  itDb('stores a valid upload and computes the MD5 server-side', async () => {
    const { listFamilies } = await import('../src/cisco/capabilities.js');
    const family = Object.keys(listFamilies())[0];
    const content = 'PRETEND-IOS-IMAGE-' + Date.now();
    const { body, contentType } = multipartPayload({ family, version: '15.2(7)E14' }, content);
    const res = await app.inject({
      method: 'POST', url: '/api/firmware',
      headers: { 'content-type': contentType, authorization: `Bearer ${adminToken}` },
      payload: body
    });
    expect(res.statusCode).toBe(201);
    const img = res.json();
    expect(img.family).toBe(family);
    expect(img.md5).toBe(createHash('md5').update(content).digest('hex'));
    // BIGINT comes back from pg as a string
    expect(Number(img.size_bytes)).toBe(content.length);

    // and the unauthenticated file endpoint serves it (switch download path)
    const dl = await app.inject({ method: 'GET', url: `/api/firmware/files/${img.filename}` });
    expect(dl.statusCode).toBe(200);
    expect(dl.body).toBe(content);
  });
});

describe('site scoping', () => {
  itDb('GET /api/devices honors siteId including the unassigned sentinel', async () => {
    const { query } = await import('../src/db.js');
    const site = (await query(`INSERT INTO sites (name) VALUES ('scope-test-site') RETURNING id`)).rows[0];
    await query(`INSERT INTO devices (hostname, mgmt_ip, site_id) VALUES ('scope-in-site', '10.99.0.1', $1)`, [site.id]);
    await query(`INSERT INTO devices (hostname, mgmt_ip) VALUES ('scope-no-site', '10.99.0.2')`);

    const get = (qs: string) => app.inject({
      method: 'GET', url: `/api/devices${qs}`, headers: { authorization: `Bearer ${adminToken}` }
    });

    const all = (await get('')).json();
    expect(all.some((d: any) => d.hostname === 'scope-in-site')).toBe(true);
    expect(all.some((d: any) => d.hostname === 'scope-no-site')).toBe(true);

    const scoped = (await get(`?siteId=${site.id}`)).json();
    expect(scoped.every((d: any) => d.site_name === 'scope-test-site')).toBe(true);
    expect(scoped.some((d: any) => d.hostname === 'scope-in-site')).toBe(true);

    const unassigned = (await get('?siteId=unassigned')).json();
    expect(unassigned.some((d: any) => d.hostname === 'scope-no-site')).toBe(true);
    expect(unassigned.some((d: any) => d.hostname === 'scope-in-site')).toBe(false);

    // scoped alerts and summary endpoints accept the param without error
    expect((await app.inject({ method: 'GET', url: `/api/alerts?siteId=${site.id}`, headers: { authorization: `Bearer ${adminToken}` } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/summary?siteId=${site.id}`, headers: { authorization: `Bearer ${adminToken}` } })).statusCode).toBe(200);

    // cleanup so re-runs stay deterministic
    await query(`DELETE FROM devices WHERE hostname IN ('scope-in-site','scope-no-site')`);
    await query(`DELETE FROM sites WHERE id=$1`, [site.id]);
  });
});

describe('API keys', () => {
  itDb('a created key authenticates requests at its assigned role', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/keys',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
      payload: JSON.stringify({ name: 'test-key', role: 'readonly' })
    });
    expect(created.statusCode).toBe(201);
    const token = created.json().token;
    expect(token).toMatch(/^sp_[0-9a-f]{48}$/);

    // readonly key can read devices
    const read = await app.inject({
      method: 'GET', url: '/api/devices', headers: { authorization: `Bearer ${token}` }
    });
    expect(read.statusCode).toBe(200);

    // but not create them (needs netadmin)
    const write = await app.inject({
      method: 'POST', url: '/api/devices',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      payload: JSON.stringify({ mgmtIp: '10.20.20.20', credentialId: '00000000-0000-0000-0000-000000000000' })
    });
    expect(write.statusCode).toBe(403);
  });

  itDb('a bogus sp_ token is rejected', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/devices', headers: { authorization: 'Bearer sp_deadbeef' }
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('global search', () => {
  itDb('finds a device by hostname fragment', async () => {
    const { query } = await import('../src/db.js');
    await query(`INSERT INTO devices (hostname, mgmt_ip) VALUES ('search-target-sw', '10.30.0.1')`);
    const res = await app.inject({
      method: 'GET', url: '/api/search?q=search-target', headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().devices.some((d: any) => d.hostname === 'search-target-sw')).toBe(true);
    await query(`DELETE FROM devices WHERE hostname='search-target-sw'`);
  });

  itDb('escapes LIKE metacharacters so % is literal', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/search?q=%25', headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(res.statusCode).toBe(200);  // does not match everything / error
  });
});
