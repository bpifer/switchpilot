// Job engine: scheduled, immediate, recurring, and bulk operations across devices.
import { createRequire } from 'node:module';
import { query } from '../db.js';
import { devicePushConfig, bouncePort } from './deviceComms.js';
import { backupDevice, checkDrift } from './configService.js';
import { renderTemplate } from './templateService.js';
import { upgradeFirmware } from './firmwareService.js';

// cron-parser is CJS; use createRequire for ESM compatibility
const require = createRequire(import.meta.url);
const cronParser = require('cron-parser') as { parseExpression: (expr: string) => { next(): { toDate(): Date } } };

function nextCronDate(expr: string): Date {
  return cronParser.parseExpression(expr).next().toDate();
}

export interface NewJob {
  type: string;
  name: string;
  payload: Record<string, unknown>;
  deviceIds: string[];
  scheduleAt: Date | null;
  cron?: string | null;
  createdBy: string;
}

export async function createJob(job: NewJob): Promise<{ id: string; status: string }> {
  const nextRunAt = job.cron ? nextCronDate(job.cron) : null;
  const { rows } = await query(
    `INSERT INTO jobs (type, name, payload, device_ids, schedule_at, cron, next_run_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, status`,
    [job.type, job.name, JSON.stringify(job.payload), job.deviceIds,
     job.scheduleAt, job.cron ?? null, nextRunAt, job.createdBy]);
  if (!job.scheduleAt && !job.cron) {
    runJob(rows[0].id).catch(err => console.error(`job ${rows[0].id} failed:`, err));
  }
  return rows[0];
}

/** Claim and execute one job; per-device results recorded in job_results. */
export async function runJob(jobId: string): Promise<void> {
  const claim = await query(
    `UPDATE jobs SET status='running', started_at=now()
     WHERE id=$1 AND status='pending' RETURNING *`, [jobId]);
  const job = claim.rows[0];
  if (!job) return;

  let allOk = true;
  for (const deviceId of job.device_ids as string[]) {
    try {
      const output = await runJobOnDevice(job, deviceId);
      await query('INSERT INTO job_results (job_id, device_id, success, output) VALUES ($1,$2,TRUE,$3)',
        [jobId, deviceId, output.slice(0, 20000)]);
    } catch (err) {
      allOk = false;
      await query('INSERT INTO job_results (job_id, device_id, success, output) VALUES ($1,$2,FALSE,$3)',
        [jobId, deviceId, (err as Error).message]);
    }
  }

  if (job.cron) {
    // Recurring: reset to pending with the next scheduled run time
    const next = nextCronDate(job.cron);
    await query(
      `UPDATE jobs SET status='pending', started_at=NULL, finished_at=NULL, next_run_at=$2 WHERE id=$1`,
      [jobId, next]);
  } else {
    await query(`UPDATE jobs SET status=$1, finished_at=now() WHERE id=$2`,
      [allOk ? 'done' : 'failed', jobId]);
  }
}

async function runJobOnDevice(job: any, deviceId: string): Promise<string> {
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
      return upgradeFirmware(deviceId, payload.imageId as string);
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

/** Called by the scheduler tick: run any one-shot jobs that are due. */
export async function runDueJobs(): Promise<void> {
  const { rows } = await query(
    `SELECT id FROM jobs WHERE status='pending' AND schedule_at IS NOT NULL AND schedule_at <= now() AND cron IS NULL`);
  for (const row of rows) {
    runJob(row.id).catch(err => console.error(`scheduled job ${row.id} failed:`, err));
  }
}

/** Called by the scheduler tick: run any recurring cron jobs that are due. */
export async function runCronJobs(): Promise<void> {
  const { rows } = await query(
    `SELECT id FROM jobs WHERE status='pending' AND cron IS NOT NULL AND next_run_at <= now()`);
  for (const row of rows) {
    runJob(row.id).catch(err => console.error(`cron job ${row.id} failed:`, err));
  }
}
