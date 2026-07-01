// Background engine: status polls, metric collection, nightly backups,
// compliance checks, due-job execution, and history pruning.
import cron from 'node-cron';
import { query } from './db.js';
import { config } from './config.js';
import { pollStatus, refreshDevice } from './services/monitorService.js';
import { checkDrift, backupDevice } from './services/configService.js';
import { raiseAlert, resolveAlert } from './services/alertService.js';
import { drainJobQueue, reapStaleJobs } from './services/jobService.js';
import { gitGc, pushMirror } from './services/configVersioning.js';
import { checkDeviceCert } from './services/certCheck.js';
import { evaluateAllCompliance } from './services/complianceService.js';
import { isLeader } from './leader.js';
import { forEachLimit } from './util/concurrency.js';
import type { DeviceRow } from './services/deviceComms.js';

const CONCURRENCY = 8;

async function eachDevice(fn: (d: DeviceRow) => Promise<void>, label: string): Promise<void> {
  const { rows } = await query<DeviceRow>('SELECT * FROM devices WHERE monitor_enabled');
  await forEachLimit(rows, CONCURRENCY, fn, (device, err) =>
    console.warn(`${label} failed for ${device.hostname || device.mgmt_ip}: ${err.message}`));
}

export function startScheduler(): void {
  // Device sweeps and maintenance crons run ONLY on the leader so a horizontally
  // scaled deployment doesn't poll/back-up every device once per replica.
  // The job queue drain + reaper run everywhere (SKIP LOCKED distributes work).

  // fast reachability poll
  setInterval(() => {
    if (!isLeader()) return;
    eachDevice(pollStatus, 'status poll').catch(err => console.error('status poll sweep failed:', err));
  }, config.poll.statusIntervalSec * 1000);

  // full metric/port/topology refresh
  setInterval(() => {
    if (!isLeader()) return;
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
    if (!isLeader()) return;
    eachDevice(async d => {
      if (d.status === 'offline') return;
      const result = await backupDevice(d.id, 'scheduler');
      if (result.changed) {
        await raiseAlert(d.id, 'config_changed', 'warning',
          `Out-of-band config change detected on ${d.hostname || d.mgmt_ip}`);
      } else {
        await resolveAlert(d.id, 'config_changed');
      }
    }, 'nightly backup')
      .then(() => pushMirror())   // off-box DR mirror, best-effort (no-op unless configured)
      .catch(err => console.error('backup sweep failed:', err));
  });

  // drift checks (running config vs pinned baseline) + rule-based compliance scoring
  cron.schedule(config.poll.complianceCron, () => {
    if (!isLeader()) return;
    eachDevice(async d => {
      if (d.status !== 'offline') await checkDrift(d.id);
    }, 'drift check').catch(err => console.error('drift sweep failed:', err));
    evaluateAllCompliance().catch(err => console.error('compliance evaluation failed:', err));
  });

  // daily TLS cert expiry check (best-effort; devices without TLS are skipped)
  if (config.certCheck.enabled) {
    cron.schedule('15 4 * * *', () => {
      if (!isLeader()) return;
      eachDevice(d => checkDeviceCert(d), 'cert check').catch(err => console.error('cert check sweep failed:', err));
    });
  }

  // prune history daily at 03:30 (windows configurable via RETAIN_* env vars)
  cron.schedule('30 3 * * *', async () => {
    if (!isLeader()) return;
    const r = config.retention;
    await query(`DELETE FROM device_metrics WHERE ts < now() - ($1 * interval '1 day')`, [r.metricsDays]);
    await query(`DELETE FROM port_metrics WHERE recorded_at < now() - ($1 * interval '1 day')`, [r.portMetricsDays]);
    await query(`DELETE FROM client_tracking WHERE last_seen < now() - ($1 * interval '1 day')`, [r.clientDays]);
    await query(`DELETE FROM alerts WHERE resolved_at IS NOT NULL AND resolved_at < now() - ($1 * interval '1 day')`, [r.alertDays]);
    await query(`DELETE FROM syslog_messages WHERE received_at < now() - ($1 * interval '1 day')`, [r.syslogDays]);
    await query(`DELETE FROM flow_records WHERE bucket < now() - ($1 * interval '1 day')`, [config.netflow.retentionDays]);
    await query(`DELETE FROM device_availability WHERE hour < now() - interval '400 days'`);
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
