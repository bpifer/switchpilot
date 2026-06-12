import { describe, it, beforeAll, afterAll, expect } from 'vitest';

// Verifies the tamper-evidence invariant of the hash-chained audit log:
// editing or deleting a committed row must make verifyAuditChain() fail and
// point at the right entry. Needs Postgres, so gated on RUN_DB_TESTS like the
// other DB-backed tests.
const RUN = !!process.env.RUN_DB_TESTS;
const itDb = RUN ? it : it.skip;

let audit: typeof import('../src/audit.js')['audit'];
let verifyAuditChain: typeof import('../src/audit.js')['verifyAuditChain'];
let query: typeof import('../src/db.js')['query'];

beforeAll(async () => {
  if (!RUN) return;
  const db = await import('../src/db.js');
  query = db.query;
  await db.migrate();
  ({ audit, verifyAuditChain } = await import('../src/audit.js'));
}, 40000);

afterAll(async () => {
  if (RUN) await (await import('../src/db.js')).pool.end();
});

describe('audit hash chain', () => {
  itDb('verifies an untampered chain', async () => {
    await audit('chain_test', 'test.entry', 'a', { n: 1 }, '127.0.0.1');
    await audit('chain_test', 'test.entry', 'b', { n: 2 }, '127.0.0.1');
    await audit('chain_test', 'test.entry', 'c', { n: 3 }, '127.0.0.1');
    const res = await verifyAuditChain();
    expect(res.valid).toBe(true);
    expect(res.checked).toBeGreaterThanOrEqual(3);
  });

  itDb('detects a modified entry', async () => {
    await audit('chain_test', 'test.tamper_target', 'x', { v: 'original' }, '127.0.0.1');
    const { rows } = await query(
      `SELECT id, detail FROM audit_log WHERE action='test.tamper_target' ORDER BY id DESC LIMIT 1`);
    const target = rows[0];

    await query(`UPDATE audit_log SET detail='{"v":"forged"}'::jsonb WHERE id=$1`, [target.id]);
    try {
      const res = await verifyAuditChain();
      expect(res.valid).toBe(false);
      expect(res.brokenAtId).toBe(target.id);
      expect(res.reason).toMatch(/modified/i);
    } finally {
      // restore so later verifications (and other test files) see a valid chain
      await query('UPDATE audit_log SET detail=$1 WHERE id=$2', [target.detail, target.id]);
    }
    expect((await verifyAuditChain()).valid).toBe(true);
  });

  itDb('detects a deleted entry (broken linkage)', async () => {
    await audit('chain_test', 'test.delete_a', '', {}, '127.0.0.1');
    await audit('chain_test', 'test.delete_target', '', {}, '127.0.0.1');
    await audit('chain_test', 'test.delete_b', '', {}, '127.0.0.1');

    const { rows } = await query(
      `SELECT id, username, action, target, detail, ip, created_at, prev_hash, entry_hash
       FROM audit_log WHERE action='test.delete_target' ORDER BY id DESC LIMIT 1`);
    const victim = rows[0];

    await query('DELETE FROM audit_log WHERE id=$1', [victim.id]);
    try {
      const res = await verifyAuditChain();
      expect(res.valid).toBe(false);
      expect(res.reason).toMatch(/deleted|chain broken|link/i);
    } finally {
      // put the row back verbatim (same id and hashes) to restore the chain
      await query(
        `INSERT INTO audit_log (id, username, action, target, detail, ip, created_at, prev_hash, entry_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [victim.id, victim.username, victim.action, victim.target, victim.detail,
         victim.ip, victim.created_at, victim.prev_hash, victim.entry_hash]);
    }
    expect((await verifyAuditChain()).valid).toBe(true);
  });
});
