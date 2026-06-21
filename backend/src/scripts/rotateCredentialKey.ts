// One-shot credential-key rotation: re-encrypt every stored secret (device
// credentials + MFA secrets) from an old CREDENTIAL_KEY to a new one, atomically.
//
// Run with the database reachable (take a DB backup first):
//   cd backend && npm run build
//   OLD_CREDENTIAL_KEY=<hex> NEW_CREDENTIAL_KEY=<hex> npm run rotate-key
// OLD_CREDENTIAL_KEY defaults to the current CREDENTIAL_KEY. Afterwards, set
// CREDENTIAL_KEY to the new value and restart. Lose the new key and the secrets
// are unrecoverable - see docs/DISASTER-RECOVERY.md.
import { pool } from '../db.js';
import { config } from '../config.js';
import { reencrypt } from '../crypto/secrets.js';

const TARGETS: { table: string; cols: string[] }[] = [
  { table: 'credentials', cols: ['ssh_password_enc', 'enable_password_enc', 'snmp_community_enc', 'snmpv3_auth_key_enc', 'snmpv3_priv_key_enc'] },
  { table: 'users', cols: ['mfa_secret'] },
];

function validKey(k: string, label: string): string {
  if (!/^[0-9a-fA-F]{64}$/.test(k)) {
    console.error(`${label} must be 64 hex characters (32 bytes).`);
    process.exit(1);
  }
  return k;
}

async function main(): Promise<void> {
  const oldKey = validKey(process.env.OLD_CREDENTIAL_KEY ?? config.credentialKey, 'OLD_CREDENTIAL_KEY');
  const newKey = validKey(process.env.NEW_CREDENTIAL_KEY ?? '', 'NEW_CREDENTIAL_KEY');
  if (oldKey.toLowerCase() === newKey.toLowerCase()) {
    console.error('OLD and NEW keys are identical - nothing to rotate.');
    process.exit(1);
  }

  const client = await pool.connect();
  let rotated = 0;
  try {
    await client.query('BEGIN');
    for (const { table, cols } of TARGETS) {
      const { rows } = await client.query(`SELECT id, ${cols.join(', ')} FROM ${table}`);
      for (const row of rows) {
        const sets: string[] = [];
        const params: unknown[] = [];
        for (const col of cols) {
          if (!row[col]) continue;                       // skip empty/null secrets
          params.push(reencrypt(oldKey, newKey, row[col]));
          sets.push(`${col}=$${params.length}`);
        }
        if (sets.length) {
          params.push(row.id);
          await client.query(`UPDATE ${table} SET ${sets.join(', ')} WHERE id=$${params.length}`, params);
          rotated += sets.length;
        }
      }
    }
    await client.query('COMMIT');
    console.log(`Re-encrypted ${rotated} secret value(s). Now set CREDENTIAL_KEY to the new key and restart.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Rotation failed and was rolled back - no changes made:', (err as Error).message);
    console.error('(A wrong OLD_CREDENTIAL_KEY makes every decrypt fail - verify the old key.)');
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
