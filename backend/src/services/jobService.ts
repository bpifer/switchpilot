// Job engine: scheduled, immediate, recurring, and bulk operations across devices.
//
// Cluster-safety model (multiple API/worker replicas against one Postgres):
//   • Jobs are claimed with `FOR UPDATE SKIP LOCKED` so exactly one replica
//     picks up each runnable job — no double execution, no contention.
//   • A running job heartbeats; a reaper requeues jobs whose worker died
//     (heartbeat went stale) up to max_attempts, with exponential backoff.
//   • Per-device progress is published over Redis pub/sub so every replica's
//     WebSocket clients see live updates regardless of which one is executing.
import { createRequire } from 'node:module';
import { hostname as osHostname } from 'node:os';
import { query } from '../db.js';
import { publishEvent } from '../redis.js';
import { devicePushConfig, bouncePort } from './deviceComms.js';
import { backupDevice, checkDrift } from './configService.js';
import { renderTemplate } from './templateService.js';
import { upgradeFirmware } from './firmwareService.js';

// cron-parser is CJS; use createRequire for ESM compatibility
const require = createRequire(import.meta.url);
const cronParser = require('cron-parser') as { parseExpression: (expr: string) => { next(): { toDate(): Date } } };

// Unique id for this process, so claimed/locked jobs are attributable.
const WORKER_ID = `${osHostname()}:${process.pid}`;

// A running job is considered dead if its heartbeat is older than this.
const STALE_MS = 2 * 60_000;
// Heartbeat cadence while a job runs.
const HEARTBEAT_MS = 30_000;

function nextCronDate(expr: string): Date {
  return cronParser.parseExpression(expr).next().toDate();
}

/** Exponential backoff (capped) between retry attempts. */
function backoffMs(attempt: number): number {
  return Math.min(5 * 60_000, 2 ** attempt * 1000); // 2s, 4s, 8s … cap 5m
}

export interface NewJob {
  type: string;
  name: string;
  payload: Record<string, unknown>;
  deviceIds: string[];
  scheduleAt: Date | null;
  cron?: string | null;
  createdBy: string;
  maxAttempts?: number;
}

export async function createJob(job: NewJob): Promise<{ id: string; status: string }> {
  const nextRunAt = job.cron ? nextCronDate(job.cron) : null;
  // run_after gates when a one-shot job becomes claimable; immediate jobs are claimable now.
  const runAfter = job.scheduleAt ?? new Date();
  const { rows } = await query(
    `INSERT INTO jobs (type, name, payload, device_ids, schedule_at, cron, next_run_at, run_after, max_attempts, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, status`,
    [job.type, job.name, JSON.stringify(job.payload), job.deviceIds,
     job.scheduleAt, job.cron ?? null, nextRunAt, runAfter,
     job.maxAttempts ?? 1, job.createdBy]);
  // Note: execution is driven entirely by the scheduler tick (drainJobQueue),
  // never inline here — that's what makes a horizontally-scaled deployment safe.
  return rows[0];
}

/**
 * Atomically claim up to `batch` runnable jobs for THIS worker and execute them.
 * Safe to call concurrently from any number of replicas.
 */
export async function drainJobQueue(batch = 5): Promise<void> {
  for (let i = 0; i < batch; i++) {
    const job = await claimNextJob();
    if (!job) return;             // nothing left to do this tick
    // fire-and-forget: let the loop claim the next job while this one runs
    runClaimedJob(job).catch(err => console.error(`job ${job.id} crashed:`, err));
  }
}

/** Claim a single runnable job using SKIP LOCKED. Returns the claimed row or null. */
async function claimNextJob(): Promise<any | null> {
  const { rows } = await query(
    `UPDATE jobs SET
        status='running', started_at=now(), heartbeat_at=now(),
        locked_by=$1, attempts=attempts+1
     WHERE id = (
        SELECT id FROM jobs
        WHERE status='pending'
          AND (run_after IS NULL OR run_after <= now())
          AND (cron IS NULL OR next_run_at <= now())
        ORDER BY run_after NULLS FIRST, created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     RETURNING *`,
    [WORKER_ID]);
  return rows[0] ?? null;
}

/** Execute a job already claimed (status=running) by this worker. */
async function runClaimedJob(job: any): Promise<void> {
  const jobId = job.id as string;
  const attempt = job.attempts as number;
  const heartbeat = setInterval(() => {
    query('UPDATE jobs SET heartbeat_at=now() WHERE id=$1 AND locked_by=$2', [jobId, WORKER_ID])
      .catch(() => { /* heartbeat best-effort */ });
  }, HEARTBEAT_MS);

  await publishEvent({ type: 'job_progress', data: { jobId, status: 'running', attempt } });

  let allOk = true;
  let lastError = '';
  try {
    for (const deviceId of job.device_ids as string[]) {
      await publishEvent({ type: 'job_progress', data: { jobId, deviceId, status: 'running', attempt } });
      // Long-running jobs report a human-readable stage, persisted + pushed live
      const onStage = async (stage: string) => {
        await query('UPDATE jobs SET stage=$1 WHERE id=$2', [stage, jobId]).catch(() => {});
        await publishEvent({ type: 'job_progress', data: { jobId, deviceId, status: 'running', stage, attempt } });
      };
      try {
        const output = await runJobOnDevice(job, deviceId, onStage);
        await query(
          'INSERT INTO job_results (job_id, device_id, success, output, attempt) VALUES ($1,$2,TRUE,$3,$4)',
          [jobId, deviceId, output.slice(0, 20000), attempt]);
        await publishEvent({ type: 'job_progress', data: { jobId, deviceId, status: 'done', attempt } });
      } catch (err) {
        allOk = false;
        lastError = (err as Error).message;
        await query(
          'INSERT INTO job_results (job_id, device_id, success, output, attempt) VALUES ($1,$2,FALSE,$3,$4)',
          [jobId, deviceId, lastError, attempt]);
        await publishEvent({ type: 'job_progress', data: { jobId, deviceId, status: 'failed', attempt, error: lastError } });
      }
    }
  } finally {
    clearInterval(heartbeat);
  }

  await finishJob(job, allOk, lastError);
}

/** Transition a finished job: recurring → reschedule; failed → retry or give up. */
async function finishJob(job: any, allOk: boolean, lastError: string): Promise<void> {
  const jobId = job.id as string;

  if (job.cron) {
    // Recurring jobs always return to pending for their next scheduled run.
    const next = nextCronDate(job.cron);
    await query(
      `UPDATE jobs SET status='pending', started_at=NULL, finished_at=NULL,
         locked_by=NULL, heartbeat_at=NULL, next_run_at=$2, run_after=$2,
         last_error=$3, stage='' WHERE id=$1`,
      [jobId, next, allOk ? '' : lastError]);
    await publishEvent({ type: 'job_progress', data: { jobId, status: 'pending', recurring: true } });
    return;
  }

  if (allOk) {
    await query(
      `UPDATE jobs SET status='done', finished_at=now(), locked_by=NULL, heartbeat_at=NULL, last_error='', stage='' WHERE id=$1`,
      [jobId]);
    await publishEvent({ type: 'job_progress', data: { jobId, status: 'done' } });
    return;
  }

  // One-shot job failed on at least one device — retry with backoff if attempts remain.
  const attempts = job.attempts as number;
  const maxAttempts = job.max_attempts as number;
  if (attempts < maxAttempts) {
    const runAfter = new Date(Date.now() + backoffMs(attempts));
    await query(
      `UPDATE jobs SET status='pending', started_at=NULL, finished_at=NULL,
         locked_by=NULL, heartbeat_at=NULL, run_after=$2, last_error=$3, stage='' WHERE id=$1`,
      [jobId, runAfter, lastError]);
    await publishEvent({ type: 'job_progress', data: { jobId, status: 'pending', retryAt: runAfter.toISOString(), attempt: attempts } });
  } else {
    await query(
      `UPDATE jobs SET status='failed', finished_at=now(), locked_by=NULL, heartbeat_at=NULL, last_error=$2, stage='' WHERE id=$1`,
      [jobId, lastError]);
    await publishEvent({ type: 'job_progress', data: { jobId, status: 'failed', error: lastError } });
  }
}

/**
 * Requeue jobs whose worker died mid-run (heartbeat went stale).
 * Called periodically by the scheduler. Respects max_attempts.
 */
export async function reapStaleJobs(): Promise<void> {
  const { rows } = await query(
    `UPDATE jobs
       SET status = CASE WHEN attempts < max_attempts THEN 'pending' ELSE 'failed' END,
           started_at = NULL,
           finished_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END,
           locked_by = NULL,
           heartbeat_at = NULL,
           run_after = now(),
           last_error = 'worker died mid-run (heartbeat timeout)'
     WHERE status='running'
       AND heartbeat_at IS NOT NULL
       AND heartbeat_at < now() - ($1::int * interval '1 millisecond')
     RETURNING id, status`,
    [STALE_MS]);
  for (const r of rows) {
    await publishEvent({ type: 'job_progress', data: { jobId: r.id, status: r.status, reaped: true } });
  }
  if (rows.length) console.warn(`reaped ${rows.length} stale job(s)`);
}

/** Manually requeue the failed devices of a job (UI "retry failed" button). */
export async function retryJob(jobId: string): Promise<boolean> {
  // Only allow retrying a job that's actually finished in a failed state.
  const { rows } = await query(
    `UPDATE jobs SET status='pending', started_at=NULL, finished_at=NULL,
        locked_by=NULL, heartbeat_at=NULL, run_after=now(),
        max_attempts=GREATEST(max_attempts, attempts+1)
     WHERE id=$1 AND status='failed' RETURNING id`,
    [jobId]);
  if (!rows[0]) return false;
  await publishEvent({ type: 'job_progress', data: { jobId, status: 'pending', manualRetry: true } });
  return true;
}

async function runJobOnDevice(
  job: any,
  deviceId: string,
  onStage: (stage: string) => Promise<void> = async () => {}
): Promise<string> {
  const payload = job.payload ?? {};
  switch (job.type) {
    case 'config_push': {
      let lines: string[];
      if (payload.templateId) {
        lines = await renderTemplate(payload.templateId, payload.variables ?? {});
      } else if (Array.isArray(payload.lines)) {
        lines = payload.lines;
      } else {
        throw new Error('config_push job needs templateId or lines');
      }
      await backupDevice(deviceId, `job:${job.id} (pre-change)`);
      return devicePushConfig(deviceId, lines, payload.save !== false);
    }
    case 'backup': {
      const result = await backupDevice(deviceId, `job:${job.id}`);
      return result.changed ? 'backup taken (config changed)' : 'no change since last backup';
    }
    case 'compliance': {
      const drifted = await checkDrift(deviceId);
      return drifted ? 'DRIFT DETECTED' : 'compliant';
    }
    case 'firmware_upgrade':
      return upgradeFirmware(deviceId, payload.imageId as string, onStage);
    case 'bounce_port': {
      const port = payload.port as string;
      if (!port) throw new Error('bounce_port job requires payload.port');
      return bouncePort(deviceId, port);
    }
    case 'custom': {
      const lines = Array.isArray(payload.lines) ? payload.lines as string[] : [];
      if (!lines.length) throw new Error('custom job requires payload.lines array');
      return devicePushConfig(deviceId, lines, payload.save !== false);
    }
    default:
      throw new Error(`Unknown job type: ${job.type}`);
  }
}
