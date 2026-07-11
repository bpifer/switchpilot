// Per-device SSH session pool. A Cisco shell session is stateful (one shell
// channel, enable mode), so concurrent operations against the same device are
// serialized on a promise chain rather than multiplexed. Sessions idle for 90s
// are closed; any operation error evicts the session so the next call gets a
// fresh connection instead of a wedged shell.
//
// Cross-replica safety: the in-process promise chain only serializes calls
// within ONE process. Under horizontal scaling (k8s api replicas > 1) a sweep
// on the leader and a UI-triggered write on another replica could otherwise
// open and drive two sessions to the same device at once. A per-device Redis
// lock (acquired inside the chain, so same-process calls never touch Redis)
// serializes device access across every replica. It degrades to a no-op when
// Redis is unavailable — single-node correctness rests on the promise chain
// alone, exactly as before.
import crypto from 'node:crypto';
import { CiscoSshSession, type SshTarget, type DeviceSession } from './sshClient.js';
import { RouterOsSshSession } from '../routeros/sshClient.js';
import { redis } from '../redis.js';

const IDLE_TTL_MS = 90_000;
const SWEEP_MS = 30_000;

// Cluster lock tuning. TTL comfortably exceeds the longest single session op
// (a full read sweep is ~10–30s) so a crashed holder self-releases; the wait
// budget bounds how long a contended caller blocks before proceeding anyway.
const LOCK_TTL_MS = 180_000;
const LOCK_WAIT_MS = 60_000;
const LOCK_RETRY_MS = 100;
// Atomic compare-and-delete: only release a lock this caller still owns (a
// lock that already expired and was re-taken by another replica must not be
// deleted out from under them).
const RELEASE_LUA =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

interface Entry {
  session: DeviceSession | null;   // opened lazily under the cluster lock
  lastUsed: number;
  chain: Promise<unknown>;
}

const pool = new Map<string, Entry>();

const keyFor = (t: SshTarget) => `${t.host}:${t.port ?? 22}:${t.username}`;

/** Acquire a cross-replica lock for this device. Returns a release fn. No-op
 *  (returns immediately) whenever Redis is unavailable, so a Redis outage can
 *  never wedge device communication — the promise chain still serializes the
 *  local process. */
async function acquireClusterLock(key: string): Promise<() => void> {
  if (redis.status !== 'ready') return () => {};
  const lockKey = `sshpool:lock:${key}`;
  const token = crypto.randomUUID();
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    let ok: string | null;
    try {
      ok = await redis.set(lockKey, token, 'PX', LOCK_TTL_MS, 'NX');
    } catch {
      return () => {};   // Redis hiccup — degrade rather than block the op
    }
    if (ok === 'OK') {
      let released = false;
      return () => {
        if (released) return;
        released = true;
        redis.eval(RELEASE_LUA, 1, lockKey, token).catch(() => { /* TTL cleans up */ });
      };
    }
    if (Date.now() >= deadline) {
      // Only reachable with a real cross-replica contender holding the lock
      // past the budget. Proceed without it rather than fail the caller; the
      // TTL frees a crashed holder. Logged so genuine contention is visible.
      console.warn(`sshPool: cluster lock for ${key} contended >${LOCK_WAIT_MS}ms, proceeding`);
      return () => {};
    }
    await new Promise(r => setTimeout(r, LOCK_RETRY_MS));
  }
}

async function openSession(t: SshTarget): Promise<DeviceSession> {
  // RouterOS uses stateless exec channels (no enable/shell); Cisco uses a shell.
  if (t.os === 'routeros') {
    const s = new RouterOsSshSession(t);
    await s.connect();
    return s;
  }
  const s = new CiscoSshSession(t);
  await s.connect();
  if (!t.skipEnable) await s.enable();
  return s;
}

/**
 * Run `fn` against a pooled session for this device, opening one if needed.
 * Calls against the same device queue behind each other; different devices
 * run in parallel. Do NOT call session.close() inside fn - the pool owns the
 * session lifecycle. For operations that intentionally drop the connection
 * (reload), use a dedicated CiscoSshSession and call evictDevice() after.
 */
export async function withDeviceSession<T>(
  target: SshTarget,
  fn: (session: DeviceSession) => Promise<T>
): Promise<T> {
  const key = keyFor(target);
  let entry = pool.get(key);
  if (!entry) {
    entry = { session: null, lastUsed: Date.now(), chain: Promise.resolve() };
    pool.set(key, entry);
  }
  const mine = entry;
  const run = mine.chain.then(async (): Promise<T> => {
    // If a failure evicted this entry while we were queued behind it, the
    // session is gone - start over and acquire a fresh one.
    if (pool.get(key) !== mine) return withDeviceSession(target, fn);
    // Cross-replica serialization. Acquired here (inside the chain, after the
    // in-process queue) so concurrent same-process callers never contend on
    // Redis - they've already been serialized and each takes/frees the lock in
    // turn. Session open happens under the lock, so two replicas can't both
    // open a session to this device at once.
    const releaseLock = await acquireClusterLock(key);
    try {
      if (!mine.session) mine.session = await openSession(target);
      mine.lastUsed = Date.now();
      return await fn(mine.session);
    } catch (err) {
      // an error mid-command (or a failed connect) can leave the shell in an
      // unknown state - drop it so the next call reconnects cleanly
      evict(key);
      throw err;
    } finally {
      releaseLock();
      mine.lastUsed = Date.now();
    }
  });
  mine.chain = run.catch(() => { /* keep the chain alive after failures */ });
  return run;
}

/** Drop a device's pooled session (e.g. after issuing a reload). */
export function evictDevice(target: SshTarget): void {
  evict(keyFor(target));
}

function evict(key: string): void {
  const e = pool.get(key);
  if (!e) return;
  pool.delete(key);
  if (e.session) {
    try { e.session.close(); } catch { /* already gone */ }
  }
}

/** Visible for tests/metrics. */
export function poolSize(): number {
  return pool.size;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, e] of pool) {
    if (now - e.lastUsed > IDLE_TTL_MS) evict(key);
  }
}, SWEEP_MS).unref();
