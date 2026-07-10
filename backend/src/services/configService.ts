import crypto from 'node:crypto';
import { query } from '../db.js';
import { deviceExec, devicePushConfig, getDevice } from './deviceComms.js';
import { driverFor } from '../drivers/index.js';
import { raiseAlert } from './alertService.js';
import { commitConfig } from './configVersioning.js';
import { previewConfigLines, type ConfigPreview } from './configPreview.js';
import { renderArubaConfig } from '../aruba/syntheticConfig.js';

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

/** Render an Aruba synthetic snapshot from the polled DB state, or null when
 *  the device has never completed a poll (no port rows yet). */
async function syntheticArubaConfig(
  deviceId: string,
  device: { hostname: string; model: string; [k: string]: unknown }
): Promise<string | null> {
  const ports = await query<{ name: string; description: string; admin_up: boolean; oper_status: string; vlan: string }>(
    'SELECT name, description, admin_up, oper_status, vlan FROM ports WHERE device_id=$1', [deviceId]);
  if (!ports.rows.length) return null;
  const links = await query<{ local_port: string; neighbor_name: string; neighbor_port: string }>(
    'SELECT local_port, neighbor_name, neighbor_port FROM topology_links WHERE device_id=$1', [deviceId]);
  return renderArubaConfig(
    { hostname: device.hostname, model: device.model, version: String(device.ios_version ?? '') },
    ports.rows, links.rows);
}

/** The device's current config text for diff/drift: an SSH running-config read
 *  for CLI vendors, the synthetic SNMP snapshot for Aruba (its "live config" IS
 *  the last-polled state). Empty string when an Aruba device has never polled. */
export async function liveConfigText(deviceId: string): Promise<string> {
  const device = await getDevice(deviceId);
  if (device.vendor === 'aruba') return (await syntheticArubaConfig(deviceId, device)) ?? '';
  const out = await deviceExec(deviceId, [driverFor(device).configCommand]);
  return Object.values(out)[0] ?? '';
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
  const device = await getDevice(deviceId);
  let content: string;
  if (device.vendor === 'aruba') {
    // SNMP-only: no CLI config to pull, so render a synthetic snapshot from the
    // state the Aruba monitor keeps in the DB. Before the first successful poll
    // there are no port rows - skip quietly rather than commit an empty shell.
    const synthetic = await syntheticArubaConfig(deviceId, device);
    if (!synthetic) return { id: '', changed: false };
    content = synthetic;
  } else {
    const cmd = driverFor(device).configCommand;
    const out = await deviceExec(deviceId, [cmd]);
    content = Object.values(out)[0] ?? '';
  }
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

  const device = await getDevice(deviceId);
  const current = await liveConfigText(deviceId);
  if (!current) return false;   // Aruba pre-first-poll: nothing to compare yet
  if (sha256(normalizeConfig(current)) === sha256(normalizeConfig(baseline.content))) return false;

  await raiseAlert(deviceId, 'config_drift', 'warning',
    'Running configuration has drifted from the assigned baseline');

  // A RouterOS /export is not replayable line-by-line (restore/rollback block
  // it at the route); never auto-push it here even if the flag was set. Aruba
  // is SNMP-only - there is no config push path at all.
  if (baseline.auto_remediate && device.vendor !== 'aruba' && driverFor(device).os !== 'routeros') {
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
