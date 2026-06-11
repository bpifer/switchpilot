// Background engine: status polls, metric collection, nightly backups,
// compliance checks, due-job execution, and history pruning.
import cron from 'node-cron';
import { query } from './db.js';
import { config } from './config.js';
import { pollStatus, refreshDevice } from './services/monitorService.js';
import { checkDrift, backupDevice } from './services/configService.js';
import { raiseAlert, resolveAlert } from './services/alertService.js';
import { drainJobQueue, reapStaleJobs } from './services/jobService.js';
import { gitGc } from './services/configVersioning.js';
import { evaluateAllCompliance } from './services/complianceService.js';
import type { DeviceRow } from './services/deviceComms.js';

const CONCURRENCY = 8;

async function eachDevice(fn: (d: DeviceRow) => Promise<void>, label: string): Promise<void> {
  const { rows } = await query<DeviceRow>('SELECT * FROM devices WHERE monitor_enabled');
  const queue = [...rows];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const device = queue.shift()!;
      try {
        await fn(device);
      } catch (err) {
        console.warn(`${label} failed for ${device.hostname || device.mgmt_ip}: ${(err as Error).message}`);
      }
    }
  });
  await Promise.all(workers);
}

export function startScheduler(): void {
  // fast reachability poll
  setInterval(() => {
    eachDevice(pollStatus, 'status poll').catch(err => console.error('status poll sweep failed:', err));
  }, config.poll.statusIntervalSec * 1000);

  // full metric/port/topology refresh
  setInterval(() => {
    eachDevice(async d => {
      if (d.status === 'offline') return;
      await refreshDevice(d.id);
    }, 'metrics refresh').catch(err => console.error('metrics sweep failed:', err));
  }, config.poll.metricsIntervalSec * 1000);

  // drain the job queue — claims runnable jobs (one-shot, scheduled, cron) with
  // SKIP LOCKED so this is safe to run on every replica simultaneously.
  setInterval(() => {
    drainJobQueue().catch(err => console.error('job queue drain failed:', err));
  }, 10_000);

  // requeue jobs whose worker died mid-run — every minute
  setInterval(() => {
    reapStaleJobs().catch(err => console.error('stale-job reaper failed:', err));
  }, 60_000);

  // nightly config backups — alert if config changed since last backup
  cron.schedule(config.poll.backupCron, () => {
    eachDevice(async d => {
      if (d.status === 'offline') return;
      const result = await backupDevice(d.id, 'scheduler');
      if (result.changed) {
        await raiseAlert(d.id, 'config_changed', 'warning',
          `Out-of-band config change detected on ${d.hostname || d.mgmt_ip}`);
      } else {
        await resolveAlert(d.id, 'config_changed');
      }
    }, 'nightly backup').catch(err => console.error('backup sweep failed:', err));
  });

  // drift checks (running config vs pinned baseline) + rule-based compliance scoring
  cron.schedule(config.poll.complianceCron, () => {
    eachDevice(async d => {
      if (d.status !== 'offline') await checkDrift(d.id);
    }, 'drift check').catch(err => console.error('drift sweep failed:', err));
    evaluateAllCompliance().catch(err => console.error('compliance evaluation failed:', err));
  });

  // prune history daily at 03:30
  cron.schedule('30 3 * * *', async () => {
    await query(`DELETE FROM device_metrics WHERE ts < now() - interval '400 days'`);
    await query(`DELETE FROM port_metrics WHERE recorded_at < now() - interval '90 days'`);
    await query(`DELETE FROM client_tracking WHERE last_seen < now() - interval '1 year'`);
    await query(`DELETE FROM alerts WHERE resolved_at IS NOT NULL AND resolved_at < now() - interval '90 days'`);
    // clean up expired maintenance windows older than 30 days
    await query(`DELETE FROM maintenance_windows WHERE ends_at < now() - interval '30 days'`);
    // keep the config-history git repo compact (runs --auto, so it's cheap on most days)
    await gitGc().catch(err => console.warn('git gc failed:', err.message));
  });

  console.log(
    `scheduler started: status every ${config.poll.statusIntervalSec}s, ` +
    `metrics every ${config.poll.metricsIntervalSec}s, backups "${config.poll.backupCron}", ` +
    `compliance "${config.poll.complianceCron}"`);
}
