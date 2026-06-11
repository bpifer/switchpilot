// Background engine: status polls, metric collection, nightly backups,
// compliance checks, due-job execution, and history pruning.
import cron from 'node-cron';
import { query } from './db.js';
import { config } from './config.js';
import { pollStatus, refreshDevice } from './services/monitorService.js';
import { checkDrift } from './services/configService.js';
import { backupDevice } from './services/configService.js';
import { runDueJobs } from './services/jobService.js';
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
      if (d.status === 'offline') return; // skip known-dead devices on the heavy poll
      await refreshDevice(d.id);
    }, 'metrics refresh').catch(err => console.error('metrics sweep failed:', err));
  }, config.poll.metricsIntervalSec * 1000);

  // due scheduled jobs — every 30s
  setInterval(() => {
    runDueJobs().catch(err => console.error('due-job runner failed:', err));
  }, 30_000);

  // nightly config backups
  cron.schedule(config.poll.backupCron, () => {
    eachDevice(async d => {
      if (d.status !== 'offline') await backupDevice(d.id, 'scheduler');
    }, 'nightly backup').catch(err => console.error('backup sweep failed:', err));
  });

  // compliance / drift checks
  cron.schedule(config.poll.complianceCron, () => {
    eachDevice(async d => {
      if (d.status !== 'offline') await checkDrift(d.id);
    }, 'compliance check').catch(err => console.error('compliance sweep failed:', err));
  });

  // prune history daily at 03:30
  cron.schedule('30 3 * * *', async () => {
    // device_metrics: keep 400 days (supports 1-year chart + buffer)
    await query(`DELETE FROM device_metrics WHERE ts < now() - interval '400 days'`);
    // port_metrics: keep 90 days
    await query(`DELETE FROM port_metrics WHERE recorded_at < now() - interval '90 days'`);
    // client_tracking: keep clients seen in last year
    await query(`DELETE FROM client_tracking WHERE last_seen < now() - interval '1 year'`);
    // resolved alerts: keep 90 days
    await query(`DELETE FROM alerts WHERE resolved_at IS NOT NULL AND resolved_at < now() - interval '90 days'`);
  });

  console.log(
    `scheduler started: status every ${config.poll.statusIntervalSec}s, ` +
    `metrics every ${config.poll.metricsIntervalSec}s, backups "${config.poll.backupCron}", ` +
    `compliance "${config.poll.complianceCron}"`);
}
