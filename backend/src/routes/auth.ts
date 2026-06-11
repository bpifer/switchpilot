import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { query } from '../db.js';
import { audit } from '../audit.js';
import { encryptSecret, decryptSecret } from '../crypto/secrets.js';
import { ldapAuthenticate, ldapEnabled } from '../auth/ldap.js';
import { requireRole } from '../auth/rbac.js';
import { getPolicy, roleRequiresMfa, passwordExpired, assertPasswordAllowed } from '../auth/securityPolicy.js';

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
      if (!authenticator.verify({ token: totp, secret })) {
        await audit(username, 'login.mfa_failed', '', {}, req.ip);
        return reply.code(401).send({ error: 'Invalid MFA code' });
      }
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
      'UPDATE users SET password_hash=$1, must_change_password=FALSE, password_changed_at=now() WHERE id=$2',
      [hash, me.sub]);
    await audit(me.username, 'password.change', '', {}, req.ip);
    return { ok: true };
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
      return reply.code(400).send({ error: 'Invalid code — MFA not enabled' });
    }
    await query('UPDATE users SET mfa_enabled=TRUE WHERE id=$1', [me.sub]);
    await audit(me.username, 'mfa.enabled', '', {}, req.ip);
    return { ok: true };
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
