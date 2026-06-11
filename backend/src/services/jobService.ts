// Job engine: scheduled, immediate, and bulk operations across devices.
import { query } from '../db.js';
import { devicePushConfig } from './deviceComms.js';
import { backupDevice, checkDrift } from './configService.js';
import { renderTemplate } from './templateService.js';
import { upgradeFirmware } from './firmwareService.js';

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
  const { rows } = await query(
    `INSERT INTO jobs (type, name, payload, device_ids, schedule_at, cron, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, status`,
    [job.type, job.name, JSON.stringify(job.payload), job.deviceIds,
     job.scheduleAt, job.cron ?? null, job.createdBy]);
  if (!job.scheduleAt && !job.cron) {
    // immediate: run async, don't block the request
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
  if (!job) return; // already claimed/cancelled

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
  await query(`UPDATE jobs SET status=$1, finished_at=now() WHERE id=$2`,
    [allOk ? 'done' : 'failed', jobId]);
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
    default:
      throw new Error(`Unknown job type: ${job.type}`);
  }
}

/** Called by the scheduler tick: run any due scheduled jobs. */
export async function runDueJobs(): Promise<void> {
  const { rows } = await query(
    `SELECT id FROM jobs WHERE status='pending' AND schedule_at IS NOT NULL AND schedule_at <= now()`);
  for (const row of rows) {
    runJob(row.id).catch(err => console.error(`scheduled job ${row.id} failed:`, err));
  }
}
