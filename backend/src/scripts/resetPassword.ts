// Break-glass password reset for a locked-out account (forgotten password,
// lost authenticator, no other superadmin to help). Needs DB access, so run it
// where the app runs - which is exactly the trust boundary: whoever can exec
// into the API container already owns the deployment.
//
//   docker compose exec api npm run reset-password -- admin
//   docker compose exec api npm run reset-password -- admin --clear-mfa
//
// Prints a generated one-time password (never accepts one on argv, where it
// would land in shell history) and forces a change at next login. --clear-mfa
// also removes the TOTP secret and any unused recovery codes, for the
// lost-authenticator case. The reset is recorded in the audit log.
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { audit } from '../audit.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const clearMfa = args.includes('--clear-mfa');
  const username = args.find(a => !a.startsWith('--'))?.trim();

  try {
    if (!username) {
      const { rows } = await pool.query(
        `SELECT username, role, auth_source, enabled, mfa_enabled FROM users ORDER BY username`);
      console.log('Usage: npm run reset-password -- <username> [--clear-mfa]');
      console.log('');
      console.log('Accounts:');
      for (const r of rows) {
        console.log(`  ${String(r.username).padEnd(20)} ${String(r.role).padEnd(11)} ` +
          `${r.auth_source}${r.enabled ? '' : '  [disabled]'}${r.mfa_enabled ? '  [mfa]' : ''}`);
      }
      return;
    }

    const { rows } = await pool.query(
      `SELECT id, auth_source, mfa_enabled FROM users WHERE username = $1`, [username]);
    if (!rows[0]) {
      console.error(`No account named "${username}" (run with no argument to list accounts).`);
      process.exitCode = 1;
      return;
    }
    if (rows[0].auth_source !== 'local') {
      console.error(`"${username}" authenticates via ${rows[0].auth_source} - reset the password in that directory instead.`);
      process.exitCode = 1;
      return;
    }

    // 15 chars from an unambiguous alphabet (no 0/O/1/l/I) - strong enough for
    // a password that must be changed at the next login anyway.
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const oneTime = Array.from(crypto.randomBytes(15), b => alphabet[b % alphabet.length]).join('');
    const hash = await bcrypt.hash(oneTime, 12);

    await pool.query(
      `UPDATE users SET password_hash = $1, must_change_password = TRUE, enabled = TRUE,
              token_valid_after = now()
       WHERE id = $2`, [hash, rows[0].id]);
    if (clearMfa) {
      await pool.query(`UPDATE users SET mfa_secret = NULL, mfa_enabled = FALSE WHERE id = $1`, [rows[0].id]);
      await pool.query(`DELETE FROM mfa_backup_codes WHERE user_id = $1 AND used_at IS NULL`, [rows[0].id]);
    }

    console.log('');
    console.log(`Password for "${username}" has been reset.`);
    console.log(`One-time password: ${oneTime}`);
    console.log('A new password is required at the next login.');
    if (clearMfa) console.log('MFA has been cleared - re-enroll from the user menu after logging in.');
    else if (rows[0].mfa_enabled) console.log('MFA is still enabled; add --clear-mfa if the authenticator is lost too.');
    console.log('');

    const actor = process.env.AUDIT_ACTOR || process.env.USER || 'break-glass-cli';
    await audit(actor, 'user.password.reset', rows[0].id,
      { username, clearedMfa: clearMfa, via: 'reset-password' }, 'cli');
    console.error(`(recorded in the audit log as "${actor}")`);
  } finally {
    await pool.end();
  }
}

void main();
