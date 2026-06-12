// Per-device SSH session pool. A Cisco shell session is stateful (one shell
// channel, enable mode), so concurrent operations against the same device are
// serialized on a promise chain rather than multiplexed. Sessions idle for 90s
// are closed; any operation error evicts the session so the next call gets a
// fresh connection instead of a wedged shell.
import { CiscoSshSession, type SshTarget } from './sshClient.js';

const IDLE_TTL_MS = 90_000;
const SWEEP_MS = 30_000;

interface Entry {
  sessionP: Promise<CiscoSshSession>;
  lastUsed: number;
  chain: Promise<unknown>;
}

const pool = new Map<string, Entry>();

const keyFor = (t: SshTarget) => `${t.host}:${t.port ?? 22}:${t.username}`;

async function openSession(t: SshTarget): Promise<CiscoSshSession> {
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
  fn: (session: CiscoSshSession) => Promise<T>
): Promise<T> {
  const key = keyFor(target);
  let entry = pool.get(key);
  if (!entry) {
    // set synchronously so a concurrent caller reuses the same pending connect
    entry = { sessionP: openSession(target), lastUsed: Date.now(), chain: Promise.resolve() };
    pool.set(key, entry);
    entry.sessionP.catch(() => evict(key));   // failed connect must not poison the pool
  }
  const mine = entry;
  const run = mine.chain.then(async (): Promise<T> => {
    // If a failure evicted this entry while we were queued behind it, the
    // session is closed - start over and acquire a fresh one.
    if (pool.get(key) !== mine) return withDeviceSession(target, fn);
    const session = await mine.sessionP;
    mine.lastUsed = Date.now();
    try {
      return await fn(session);
    } catch (err) {
      // an error mid-command can leave the shell in an unknown state - drop it
      evict(key);
      throw err;
    } finally {
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
  e.sessionP.then(s => s.close()).catch(() => { /* never connected */ });
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
