import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { authenticator } from 'otplib';
import { query } from '../db.js';
import { audit } from '../audit.js';
import { encryptSecret, decryptSecret } from '../crypto/secrets.js';
import { ldapAuthenticate, ldapEnabled } from '../auth/ldap.js';
import { requireRole, bustAuthCache } from '../auth/rbac.js';
import { getPolicy, roleRequiresMfa, passwordExpired, assertPasswordAllowed } from '../auth/securityPolicy.js';

/** Try to redeem a single-use MFA backup code. Returns true (and burns the code) on match. */
async function redeemBackupCode(userId: string, code: string): Promise<boolean> {
  const { rows } = await query(
    'SELECT id, code_hash FROM mfa_backup_codes WHERE user_id=$1 AND used_at IS NULL', [userId]);
  for (const row of rows) {
    if (await bcrypt.compare(code, row.code_hash)) {
      await query('UPDATE mfa_backup_codes SET used_at=now() WHERE id=$1', [row.id]);
      return true;
    }
  }
  return false;
}

export default async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', {
    // Tight per-IP throttle to blunt credential-stuffing/brute-force attempts.
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      tags: ['auth'],
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string' },
          password: { type: 'string' },
          totp: { type: 'string' }
        }
      }
    }
  }, async (req, reply) => {
    const { username, password, totp } = req.body as { username: string; password: string; totp?: string };
    const { rows } = await query('SELECT * FROM users WHERE username=$1 AND enabled', [username]);
    let user = rows[0];
    const policy = await getPolicy();

    // Account lockout: refuse before checking the password if the account is locked.
    if (user?.locked_until && new Date(user.locked_until) > new Date()) {
      await audit(username, 'login.locked_out', '', {}, req.ip);
      const mins = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
      return reply.code(423).send({ error: `Account locked. Try again in ${mins} minute(s).` });
    }

    let ok = false;
    if (user?.auth_source === 'local' && user.password_hash) {
      ok = await bcrypt.compare(password, user.password_hash);
    } else if (ldapEnabled()) {
      const ldapResult = await ldapAuthenticate(username, password);
      if (ldapResult) {
        ok = true;
        // JIT-provision/refresh LDAP users
        const upsert = await query(
          `INSERT INTO users (username, display_name, email, auth_source, role)
           VALUES ($1,$2,$3,'ldap',$4)
           ON CONFLICT (username) DO UPDATE SET display_name=$2, email=$3, role=$4
           RETURNING *`,
          [username, ldapResult.displayName, ldapResult.email, ldapResult.role]
        );
        user = upsert.rows[0];
      }
    }

    if (!ok || !user) {
      // Count the failure and lock the account once the threshold is reached (local accounts we can track).
      if (user && policy.lockout_threshold > 0) {
        const failures = (user.failed_login_count ?? 0) + 1;
        if (failures >= policy.lockout_threshold) {
          const until = new Date(Date.now() + policy.lockout_minutes * 60_000);
          await query('UPDATE users SET failed_login_count=$1, locked_until=$2 WHERE id=$3', [failures, until, user.id]);
          await audit(username, 'login.locked', '', { failures }, req.ip);
        } else {
          await query('UPDATE users SET failed_login_count=$1 WHERE id=$2', [failures, user.id]);
        }
      }
      await audit(username, 'login.failed', '', {}, req.ip);
      return reply.code(401).send({ error: 'Invalid username or password' });
    }

    if (user.mfa_enabled) {
      if (!totp) return reply.code(401).send({ error: 'MFA code required', mfaRequired: true });
      const secret = decryptSecret(user.mfa_secret);
      const totpOk = authenticator.verify({ token: totp, secret });
      // Longer codes are recovery codes: single-use fallback for a lost authenticator.
      const backupOk = !totpOk && totp.length > 6 && await redeemBackupCode(user.id, totp);
      if (!totpOk && !backupOk) {
        await audit(username, 'login.mfa_failed', '', {}, req.ip);
        return reply.code(401).send({ error: 'Invalid MFA code' });
      }
      if (backupOk) await audit(username, 'login.backup_code_used', '', {}, req.ip);
    }

    // Successful auth: clear any failure/lock state.
    await query('UPDATE users SET last_login_at=now(), failed_login_count=0, locked_until=NULL WHERE id=$1', [user.id]);

    // Password expiry → force a change on next use.
    let mustChange = user.must_change_password;
    if (passwordExpired(user.password_changed_at, policy)) {
      if (!mustChange) await query('UPDATE users SET must_change_password=TRUE WHERE id=$1', [user.id]);
      mustChange = true;
    }
    // MFA enforcement: this role must enroll before using the app.
    const mfaSetupRequired = roleRequiresMfa(user.role, policy) && !user.mfa_enabled;

    await audit(username, 'login', '', { source: user.auth_source }, req.ip);
    const token = app.jwt.sign({ sub: user.id, username: user.username, role: user.role });
    return {
      token,
      user: {
        id: user.id, username: user.username, displayName: user.display_name,
        role: user.role, mustChangePassword: mustChange, mfaSetupRequired
      }
    };
  });

  app.post('/api/auth/change-password', {
    preHandler: requireRole('readonly'),
    schema: {
      tags: ['auth'],
      body: {
        type: 'object', required: ['currentPassword', 'newPassword'],
        properties: { currentPassword: { type: 'string' }, newPassword: { type: 'string', minLength: 12 } }
      }
    }
  }, async (req, reply) => {
    const { currentPassword, newPassword } = req.body as any;
    const me = req.user as any;
    const { rows } = await query('SELECT * FROM users WHERE id=$1', [me.sub]);
    const user = rows[0];
    if (user.auth_source !== 'local') return reply.code(400).send({ error: 'Password is managed by your directory' });
    if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
      return reply.code(401).send({ error: 'Current password is incorrect' });
    }
    if (await bcrypt.compare(newPassword, user.password_hash)) {
      return reply.code(400).send({ error: 'New password must differ from the current one' });
    }
    try { await assertPasswordAllowed(newPassword); }
    catch (err: any) { return reply.code(400).send({ error: err.message }); }
    const hash = await bcrypt.hash(newPassword, 12);
    await query(
      `UPDATE users SET password_hash=$1, must_change_password=FALSE, password_changed_at=now(),
              token_valid_after=now() WHERE id=$2`,
      [hash, me.sub]);
    bustAuthCache(me.sub);
    await audit(me.username, 'password.change', '', {}, req.ip);
    // Changing the password revokes every outstanding session for this account
    // (the point: a stolen token dies with the old password). The response
    // carries a fresh token so the session that made the change survives.
    return { ok: true, token: app.jwt.sign({ sub: me.sub, username: me.username, role: user.role }) };
  });

  // MFA enrollment: generate secret, user confirms with a valid code
  app.post('/api/auth/mfa/setup', { preHandler: requireRole('readonly'), schema: { tags: ['auth'] } },
    async (req) => {
      const me = req.user as any;
      const secret = authenticator.generateSecret();
      await query('UPDATE users SET mfa_secret=$1, mfa_enabled=FALSE WHERE id=$2',
        [encryptSecret(secret), me.sub]);
      return {
        secret,
        otpauthUrl: authenticator.keyuri(me.username, 'SwitchPilot', secret)
      };
    });

  app.post('/api/auth/mfa/confirm', {
    preHandler: requireRole('readonly'),
    schema: {
      tags: ['auth'],
      body: { type: 'object', required: ['totp'], properties: { totp: { type: 'string' } } }
    }
  }, async (req, reply) => {
    const me = req.user as any;
    const { totp } = req.body as any;
    const { rows } = await query('SELECT mfa_secret FROM users WHERE id=$1', [me.sub]);
    const secret = decryptSecret(rows[0]?.mfa_secret ?? '');
    if (!secret || !authenticator.verify({ token: totp, secret })) {
      return reply.code(400).send({ error: 'Invalid code - MFA not enabled' });
    }
    await query('UPDATE users SET mfa_enabled=TRUE WHERE id=$1', [me.sub]);

    // Issue 8 single-use recovery codes (shown once; only hashes are stored).
    // Replaces any codes from a previous enrollment.
    await query('DELETE FROM mfa_backup_codes WHERE user_id=$1', [me.sub]);
    const backupCodes: string[] = [];
    for (let i = 0; i < 8; i++) {
      const code = randomBytes(5).toString('hex'); // 10 chars, distinct from 6-digit TOTP
      backupCodes.push(code);
      await query('INSERT INTO mfa_backup_codes (user_id, code_hash) VALUES ($1,$2)',
        [me.sub, await bcrypt.hash(code, 10)]);
    }

    await audit(me.username, 'mfa.enabled', '', {}, req.ip);
    return { ok: true, backupCodes };
  });

  // Sliding session: a valid (non-expired) token can be exchanged for a fresh one,
  // so long-lived dashboards never hit a silent mid-session expiry.
  app.post('/api/auth/refresh', { preHandler: requireRole('readonly'), schema: { tags: ['auth'] } },
    async (req, reply) => {
      const me = req.user as any;
      const { rows } = await query('SELECT id, username, role, enabled FROM users WHERE id=$1', [me.sub]);
      const user = rows[0];
      if (!user?.enabled) return reply.code(401).send({ error: 'Account disabled' });
      // Re-read role from the DB so a demotion takes effect at refresh time.
      return { token: app.jwt.sign({ sub: user.id, username: user.username, role: user.role }) };
    });

  // Short-lived nonce for the WebSocket upgrade. The session JWT never appears
  // in a URL (and therefore never lands in proxy/access logs); the client
  // exchanges it here for a 30-second single-purpose token instead.
  app.post('/api/auth/ws-token', { preHandler: requireRole('readonly'), schema: { tags: ['auth'] } },
    async (req) => {
      const me = req.user as any;
      return { token: app.jwt.sign({ sub: me.sub, username: me.username, ws: true }, { expiresIn: '30s' }) };
    });

  app.get('/api/auth/me', { preHandler: requireRole('readonly'), schema: { tags: ['auth'] } },
    async (req) => {
      const me = req.user as any;
      const { rows } = await query(
        'SELECT id, username, display_name, email, role, mfa_enabled, must_change_password FROM users WHERE id=$1',
        [me.sub]);
      const user = rows[0];
      if (!user) return user;
      const policy = await getPolicy();
      return { ...user, mfa_setup_required: roleRequiresMfa(user.role, policy) && !user.mfa_enabled };
    });
}
