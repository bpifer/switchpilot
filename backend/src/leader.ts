// Scheduler leader election via a Postgres session-level advisory lock.
//
// The job *queue* is already multi-replica safe (FOR UPDATE SKIP LOCKED), but
// the cron sweeps (status poll, metrics refresh, nightly backup, compliance,
// prune) must run on exactly ONE instance — otherwise every device gets polled
// and backed up N times. Whichever replica holds the advisory lock is the
// leader; a session-level lock auto-releases if that process dies, so another
// replica transparently takes over. Single-replica deploys just always win.
import pg from 'pg';
import { config } from './config.js';

const LEADER_LOCK_KEY = 911_002;   // arbitrary, must be identical across replicas
const RETRY_MS = 3_000;   // short retry keeps the failover blind spot small

let leader = false;
let client: pg.Client | null = null;

export function isLeader(): boolean {
  return leader;
}

async function ensureLeadership(): Promise<void> {
  try {
    if (!client) {
      client = new pg.Client(config.db);
      client.on('error', () => { leader = false; client = null; });
      await client.connect();
    }
    if (!leader) {
      const { rows } = await client.query<{ ok: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS ok', [LEADER_LOCK_KEY]);
      if (rows[0]?.ok === true) {
        leader = true;
        console.log('[leader] this instance acquired scheduler leadership');
      }
    }
  } catch {
    // lost the connection (and with it the lock) — drop it and retry next tick
    leader = false;
    try { await client?.end(); } catch { /* already gone */ }
    client = null;
  }
}

/** Begin contending for leadership and keep retrying for the process lifetime. */
export async function startLeaderElection(): Promise<void> {
  await ensureLeadership();
  setInterval(() => { ensureLeadership().catch(() => { /* handled inside */ }); }, RETRY_MS);
}
