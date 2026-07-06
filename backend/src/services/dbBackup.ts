// In-app disaster-recovery: dump/restore the whole SwitchPilot database with the
// bundled pg client (postgresql16-client in the image). Custom format (-Fc) is
// compressed and restorable with pg_restore's selective/parallel options. These
// are superadmin-only, audited operations; restore is destructive and always
// takes a safety dump of the current DB first.
import { spawn } from 'node:child_process';
import { readdir, stat, unlink } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { config } from '../config.js';

/** pg_dump/pg_restore read connection params from PG* env; mirror the app's. */
function pgEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PGHOST: config.db.host,
    PGPORT: String(config.db.port),
    PGDATABASE: config.db.database,
    PGUSER: config.db.user,
    PGPASSWORD: config.db.password,
  };
}

/** Run a pg tool to completion, capturing combined stdout+stderr. Resolves the
 *  output on exit 0, rejects with the tail of stderr otherwise. */
function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { env: pgEnv() });
    let out = '';
    let err = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', d => { err += d.toString(); });
    proc.on('error', reject);
    proc.on('close', code => code === 0
      ? resolve(out + err)
      : reject(new Error(`${cmd} exited ${code}: ${(err || out).slice(-800)}`)));
  });
}

/** A timestamped download filename for a dump. */
export function dumpFilename(): string {
  const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  return `switchpilot-${ts}.dump`;
}

/** Spawn `pg_dump -Fc` and return its stdout stream plus a promise that settles
 *  when the dump finishes (rejects on non-zero exit). Stream this to the client
 *  so a large DB never has to buffer in memory. */
export function pgDumpStream(): { stream: Readable; done: Promise<void> } {
  const proc = spawn('pg_dump', ['-Fc', '--no-owner', '--no-privileges'], { env: pgEnv() });
  let err = '';
  proc.stderr.on('data', d => { err += d.toString(); });
  const done = new Promise<void>((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`pg_dump exited ${code}: ${err.slice(-800)}`)));
  });
  return { stream: proc.stdout, done };
}

export interface RestoreResult { safetyBackupPath: string; log: string; }

/** Restore a custom-format dump over the current database. Takes a safety dump
 *  of the CURRENT state first (written under configHistoryDir's parent /data so
 *  it survives), then pg_restore --clean --if-exists so pre-existing objects are
 *  replaced. Rejects a file that isn't a PostgreSQL custom-format dump. */
export async function restoreDump(dumpPath: string): Promise<RestoreResult> {
  // Guard: custom-format dumps start with the magic "PGDMP".
  const { readSync, openSync, closeSync } = await import('node:fs');
  const fd = openSync(dumpPath, 'r');
  try {
    const head = Buffer.alloc(5);
    readSync(fd, head, 0, 5, 0);
    if (head.toString('latin1') !== 'PGDMP') {
      throw Object.assign(new Error('Not a SwitchPilot database backup (expected a pg_dump custom-format file).'), { statusCode: 400 });
    }
  } finally { closeSync(fd); }

  const safetyBackupPath = `/data/pre-restore-${Date.now()}.dump`;
  await run('pg_dump', ['-Fc', '--no-owner', '--no-privileges', '-f', safetyBackupPath]);

  // --clean --if-exists drops existing objects before recreating them. pg_restore
  // returns non-zero on any error; --exit-on-error is intentionally NOT set so a
  // benign "already exists"/ownership notice doesn't abort a working restore, and
  // we surface the full log to the operator.
  const log = await run('pg_restore', [
    '--clean', '--if-exists', '--no-owner', '--no-privileges',
    '--dbname', config.db.database, dumpPath,
  ]).catch(err => {
    // pg_restore commonly exits 1 with recoverable warnings; return its log
    // rather than failing outright, but keep the message for the audit trail.
    return `pg_restore reported issues (often benign drop/ownership notices):\n${(err as Error).message}`;
  });
  return { safetyBackupPath, log };
}

/** Delete pre-restore safety dumps older than maxAgeDays so occasional restores
 *  don't silently fill /data. Best-effort; a failure is logged, never thrown. */
export async function pruneOldSafetyDumps(maxAgeDays = 7): Promise<void> {
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  try {
    const entries = await readdir('/data');
    for (const name of entries) {
      if (!/^pre-restore-\d+\.dump$/.test(name)) continue;
      const p = `/data/${name}`;
      const st = await stat(p).catch(() => null);
      if (st && st.mtimeMs < cutoff) await unlink(p).catch(() => {});
    }
  } catch (err) {
    console.warn('safety dump prune failed:', (err as Error).message);
  }
}
