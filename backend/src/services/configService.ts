import crypto from 'node:crypto';
import { query } from '../db.js';
import { deviceExec, devicePushConfig, getDevice } from './deviceComms.js';
import { driverFor } from '../drivers/index.js';
import { raiseAlert } from './alertService.js';
import { commitConfig } from './configVersioning.js';
import { previewConfigLines, type ConfigPreview } from './configPreview.js';

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** Strip volatile/comment lines so hash comparison ignores timestamps. Handles
 *  Cisco (`!`, "Building configuration") and RouterOS (`#` export header, which
 *  carries a timestamp and would otherwise make every backup look changed). */
function normalizeConfig(content: string): string {
  return content.split('\n')
    .filter(l => !/^(!|#|ntp clock-period|Building configuration|Current configuration|! Last configuration|! NVRAM config)/.test(l.trim()))
    .map(l => l.trimEnd())
    .join('\n')
    .trim();
}

export interface BackupOptions {
  reason?: string;   // why this backup was taken (free text)
  ticket?: string;   // change ticket reference
}

/** Take a running-config backup; skips insert if identical to the latest backup. */
export async function backupDevice(
  deviceId: string,
  takenBy = 'scheduler',
  opts: BackupOptions = {}
): Promise<{ id: string; changed: boolean }> {
  const cmd = driverFor(await getDevice(deviceId)).configCommand;
  const out = await deviceExec(deviceId, [cmd]);
  const content = Object.values(out)[0] ?? '';
  if (!content || content.length < 50) throw new Error('Backup returned empty configuration — aborting');
  const hash = sha256(normalizeConfig(content));

  const latest = await query(
    'SELECT id, sha256 FROM config_backups WHERE device_id=$1 ORDER BY created_at DESC LIMIT 1', [deviceId]);
  if (latest.rows[0]?.sha256 === hash) return { id: latest.rows[0].id, changed: false };

  // Fetch hostname + site for the git commit (author, message, folder layout)
  const dev = await query(
    `SELECT d.hostname, s.name AS site_name
       FROM devices d LEFT JOIN sites s ON s.id = d.site_id
      WHERE d.id=$1`, [deviceId]);
  const hostname = dev.rows[0]?.hostname ?? deviceId;
  const site = dev.rows[0]?.site_name ?? null;

  const gitSha = await commitConfig(
    hostname, content,
    `${hostname}: config change captured`,
    { takenBy, reason: opts.reason, ticket: opts.ticket, site }
  );

  const { rows } = await query(
    `INSERT INTO config_backups (device_id, kind, content, sha256, taken_by, git_sha, reason, ticket)
     VALUES ($1,'running',$2,$3,$4,$5,$6,$7) RETURNING id`,
    [deviceId, content, hash, takenBy, gitSha ?? null, opts.reason ?? '', opts.ticket ?? '']);
  return { id: rows[0].id, changed: true };
}

/** Turn a stored config (backup/baseline/git snapshot) into lines that can be
 *  replayed through `configure terminal`: drop blanks, comments, and the
 *  headers IOS prints around a running-config dump. Shared by drift
 *  remediation, restore, and rollback so they replay identically. */
export function replayableLines(content: string): string[] {
  return content.split('\n')
    .filter(l => l.trim() && !l.startsWith('!') && !/^(version|Building configuration|Current configuration)/.test(l));
}

async function baselineFor(deviceId: string): Promise<{ auto_remediate: boolean; content: string } | null> {
  const { rows } = await query(
    `SELECT b.auto_remediate, cb.content, cb.sha256
     FROM config_baselines b JOIN config_backups cb ON cb.id=b.backup_id
     WHERE b.device_id=$1`, [deviceId]);
  return rows[0] ?? null;
}

/**
 * Compare current running config to the device baseline.
 * Returns true if drift detected. Auto-remediates when the baseline says so.
 */
export async function checkDrift(deviceId: string): Promise<boolean> {
  const baseline = await baselineFor(deviceId);
  if (!baseline) return false;

  const cmd = driverFor(await getDevice(deviceId)).configCommand;
  const out = await deviceExec(deviceId, [cmd]);
  const current = Object.values(out)[0] ?? '';
  if (sha256(normalizeConfig(current)) === sha256(normalizeConfig(baseline.content))) return false;

  await raiseAlert(deviceId, 'config_drift', 'warning',
    'Running configuration has drifted from the assigned baseline');

  if (baseline.auto_remediate) {
    await devicePushConfig(deviceId, replayableLines(baseline.content), true);
    await raiseAlert(deviceId, 'config_drift', 'info', 'Baseline configuration automatically restored');
  }
  return true;
}

/** Dry run of baseline remediation: classify the lines a remediation WOULD
 *  replay against the live running config, without pushing anything. Shows
 *  exactly what auto-remediate (or a manual restore-to-baseline) would do. */
export async function driftRemediationPreview(
  deviceId: string
): Promise<ConfigPreview & { lines_total: number; auto_remediate: boolean }> {
  const baseline = await baselineFor(deviceId);
  if (!baseline) throw Object.assign(new Error('Device has no baseline set'), { statusCode: 404 });
  const lines = replayableLines(baseline.content);
  const preview = await previewConfigLines(deviceId, lines);
  return { ...preview, lines_total: lines.length, auto_remediate: baseline.auto_remediate };
}
