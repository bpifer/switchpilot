import nodemailer from 'nodemailer';
import { query } from '../db.js';
import { config } from '../config.js';
import { publishEvent } from '../redis.js';

export type Severity = 'info' | 'warning' | 'critical';

/**
 * Record an alert and fan out notifications.
 * Deduplicates open alerts of the same kind on the same device.
 * Suppressed if the device is inside an active maintenance window.
 */
export async function raiseAlert(
  deviceId: string | null,
  kind: string,
  severity: Severity,
  message: string
): Promise<void> {
  // Suppress during active maintenance windows
  if (deviceId) {
    const mw = await query(
      `SELECT id FROM maintenance_windows
       WHERE now() BETWEEN starts_at AND ends_at
       AND (cardinality(device_ids) = 0 OR $1::uuid = ANY(device_ids))
       LIMIT 1`,
      [deviceId]);
    if (mw.rowCount) return;
  }

  const existing = await query(
    `SELECT id FROM alerts WHERE device_id IS NOT DISTINCT FROM $1 AND kind=$2 AND resolved_at IS NULL`,
    [deviceId, kind]);
  if (existing.rowCount) return;

  await query(
    'INSERT INTO alerts (device_id, severity, kind, message) VALUES ($1,$2,$3,$4)',
    [deviceId, severity, kind, message]);

  // Fan out to all connected API instances via Redis pub/sub
  publishEvent({ type: 'alert', data: { deviceId, kind, severity, message, ts: new Date().toISOString() } }).catch(() => {});

  let hostname = 'platform';
  if (deviceId) {
    const d = await query('SELECT hostname, mgmt_ip FROM devices WHERE id=$1', [deviceId]);
    hostname = d.rows[0] ? `${d.rows[0].hostname} (${d.rows[0].mgmt_ip})` : deviceId;
  }
  const title = `[SwitchPilot ${severity.toUpperCase()}] ${hostname}: ${kind}`;
  await Promise.allSettled([
    sendEmail(title, message),
    sendTeams(title, message, severity),
    sendSlack(title, message)
  ]);
}

/** Resolve any open alert of a kind for a device (e.g. device came back online). */
export async function resolveAlert(deviceId: string, kind: string): Promise<void> {
  await query(
    'UPDATE alerts SET resolved_at=now() WHERE device_id=$1 AND kind=$2 AND resolved_at IS NULL',
    [deviceId, kind]);
}

async function sendEmail(subject: string, body: string): Promise<void> {
  if (!config.smtp.host) return;
  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined
  });
  const { rows } = await query(
    `SELECT email FROM users WHERE enabled AND email IS NOT NULL AND role IN ('superadmin','netadmin')`);
  const to = rows.map(r => r.email).join(',');
  if (!to) return;
  await transport.sendMail({ from: config.smtp.from, to, subject, text: body });
}

async function sendTeams(title: string, text: string, severity: Severity): Promise<void> {
  if (!config.teamsWebhook) return;
  const color = severity === 'critical' ? 'FF0000' : severity === 'warning' ? 'FFA500' : '0078D7';
  await fetch(config.teamsWebhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      '@type': 'MessageCard', '@context': 'https://schema.org/extensions',
      themeColor: color, summary: title, title, text
    })
  });
}

async function sendSlack(title: string, text: string): Promise<void> {
  if (!config.slackWebhook) return;
  await fetch(config.slackWebhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: `*${title}*\n${text}` })
  });
}
