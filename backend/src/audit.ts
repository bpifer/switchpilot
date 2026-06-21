import crypto from 'node:crypto';
import { pool, query } from './db.js';

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

// Arbitrary fixed key so all audit writes serialize on the same advisory lock,
// keeping the hash chain strictly ordered even under concurrent requests.
const AUDIT_LOCK_KEY = 770120;

/** Canonical string hashed for a row. Uses Postgres's jsonb→text form for `detail`
 *  (read back via detail::text) so write-time and verify-time hashes always match. */
function canonical(prevHash: string, r: {
  id: number | string; username: string; action: string; target: string;
  detail_text: string; ip: string; created_at: Date | string;
}): string {
  const ts = r.created_at instanceof Date ? r.created_at.toISOString() : new Date(r.created_at).toISOString();
  return [prevHash, r.id, r.username, r.action, r.target, r.detail_text, r.ip, ts].join('|');
}

export async function audit(
  username: string,
  action: string,
  target = '',
  detail: Record<string, unknown> = {},
  ip = ''
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [AUDIT_LOCK_KEY]);
    const prev = await client.query('SELECT entry_hash FROM audit_log ORDER BY id DESC LIMIT 1');
    const prevHash = prev.rows[0]?.entry_hash ?? '';
    const ins = await client.query(
      `INSERT INTO audit_log (username, action, target, detail, ip, prev_hash)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at, detail::text AS detail_text`,
      [username, action, target, JSON.stringify(detail), ip, prevHash]);
    const row = ins.rows[0];
    const entryHash = sha256(canonical(prevHash, { ...row, username, action, target, ip }));
    await client.query('UPDATE audit_log SET entry_hash=$1 WHERE id=$2', [entryHash, row.id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('audit log write failed:', err);
  } finally {
    client.release();
  }
}

/** Prepare device command output for an audit `detail`: mask anything that looks
 *  like a secret and cap the size so a large dump can't bloat the (hash-chained)
 *  log. Heuristic - push output rarely echoes secrets, but be safe. */
export function redactForAudit(output: string, max = 4000): string {
  if (!output) return '';
  const masked = output.replace(
    /\b(password|secret|community|passphrase|psk|pre-shared-key|private-key|key)(\s+(?:\d+\s+)?)(\S+)/gi,
    '$1$2[redacted]');
  return masked.length > max ? `${masked.slice(0, max)}\n... [truncated, ${masked.length - max} more chars]` : masked;
}

export interface AuditVerifyResult {
  valid: boolean;
  checked: number;
  legacySkipped: number;       // pre-hardening rows that predate the hash chain
  brokenAtId: number | null;   // first row whose hash/linkage doesn't verify
  reason: string;
}

/** Recompute the audit hash chain and report the first inconsistency.
 *  Rows written before the hash chain existed (empty entry_hash) are skipped:
 *  the chain is verified from the first hashed entry onward. */
export async function verifyAuditChain(): Promise<AuditVerifyResult> {
  const { rows: all } = await query<{
    id: number; username: string; action: string; target: string;
    detail_text: string; ip: string; created_at: Date; prev_hash: string; entry_hash: string;
  }>(`SELECT id, username, action, target, detail::text AS detail_text, ip, created_at, prev_hash, entry_hash
      FROM audit_log ORDER BY id ASC`);

  const rows = all.filter(r => r.entry_hash !== '');
  const legacySkipped = all.length - rows.length;

  let expectedPrev = '';
  let first = true;
  for (const r of rows) {
    // The first hashed row links to whatever preceded it (legacy row → ''), so
    // only enforce strict linkage from the second hashed row onward.
    if (!first && r.prev_hash !== expectedPrev) {
      return { valid: false, checked: rows.length, legacySkipped, brokenAtId: r.id,
        reason: `entry #${r.id} does not link to the previous entry (chain broken — a row may have been deleted or reordered)` };
    }
    const recomputed = sha256(canonical(r.prev_hash, r));
    if (recomputed !== r.entry_hash) {
      return { valid: false, checked: rows.length, legacySkipped, brokenAtId: r.id,
        reason: `entry #${r.id} content hash does not match (it was modified after being written)` };
    }
    expectedPrev = r.entry_hash;
    first = false;
  }
  return { valid: true, checked: rows.length, legacySkipped, brokenAtId: null, reason: 'chain intact' };
}
