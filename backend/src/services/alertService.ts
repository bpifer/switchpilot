import nodemailer from 'nodemailer';
import { createHmac } from 'node:crypto';
import { query } from '../db.js';
import { config } from '../config.js';
import { publishEvent } from '../redis.js';
import { dispatchNotifications, buildDiscord, buildNtfy, buildGotify, buildTelegram, buildPushover, type NotifyRequest } from './notifiers.js';
import { fetchWithRetry } from '../util/httpRetry.js';

export type Severity = 'info' | 'warning' | 'critical';
const SEV_RANK: Record<Severity, number> = { info: 1, warning: 2, critical: 3 };

/** A subscription fires only when the alert is at least as severe as its floor. */
export function webhookMatchesSeverity(alert: Severity, min: Severity): boolean {
  return SEV_RANK[alert] >= SEV_RANK[min];
}

// Email throttle: at most one email per (device, kind) per hour, so a flapping
// link doesn't fill an inbox. Per-replica state is fine - alerts dedupe in the
// DB first, so only the replica that raised the alert sends anything.
const lastEmail = new Map<string, number>();
const EMAIL_THROTTLE_MS = 3600_000;

/** True if the device is inside an active maintenance window right now. Shared
 *  by alert suppression AND state-changing automation gating, so "hands off
 *  during a window" means the same thing for both. A window with no device_ids
 *  covers the whole fleet. */
export async function inMaintenanceWindow(deviceId: string): Promise<boolean> {
  const mw = await query(
    `SELECT id FROM maintenance_windows
     WHERE now() BETWEEN starts_at AND ends_at
     AND (cardinality(device_ids) = 0 OR $1::uuid = ANY(device_ids))
     LIMIT 1`,
    [deviceId]);
  return mw.rowCount ? true : false;
}

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
  if (deviceId && await inMaintenanceWindow(deviceId)) return;

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

  // Email only for warning+ and throttled per device+kind
  const emailKey = `${deviceId ?? 'platform'}:${kind}`;
  const shouldEmail = SEV_RANK[severity] >= SEV_RANK.warning &&
    Date.now() - (lastEmail.get(emailKey) ?? 0) > EMAIL_THROTTLE_MS;
  if (shouldEmail) lastEmail.set(emailKey, Date.now());

  // Built-in Teams/Slack senders await (bounded by their own fetch); webhooks
  // are fire-and-forget so a hung target can't back up the alert pipeline
  // during a flap storm. Per-webhook errors are handled inside fireWebhooks.
  fireWebhooks({ event: 'alert', deviceId, hostname, kind, severity, message, ts: new Date().toISOString() })
    .catch(() => {});

  await Promise.allSettled([
    shouldEmail ? sendEmail(title, message) : Promise.resolve(),
    sendTeams(title, message, severity),
    sendSlack(title, message),
    // Homelab/self-hosted channels (Discord, ntfy, Gotify, Telegram, Pushover);
    // each is a no-op unless its env vars are set.
    dispatchNotifications(title, message, severity)
  ]);
}

// 30s cache of the enabled subscription list so a busy alert path (or a system
// with no webhooks at all) doesn't hit the DB on every single alert.
let subCache: { rows: any[]; ts: number } | null = null;
const SUB_CACHE_TTL = 30_000;

/** Drop the subscription cache after any webhook create/update/delete. */
export function invalidateWebhookCache(): void {
  subCache = null;
}

async function getEnabledSubs(): Promise<any[]> {
  if (subCache && Date.now() - subCache.ts < SUB_CACHE_TTL) return subCache.rows;
  const { rows } = await query('SELECT * FROM webhook_subscriptions WHERE enabled')
    .catch(() => ({ rows: [] as any[] }));
  subCache = { rows, ts: Date.now() };
  return rows;
}

/**
 * POST the payload to every enabled webhook subscription whose min_severity
 * is at or below the alert's severity. When a secret is configured the body
 * is signed: X-SwitchPilot-Signature: sha256=<hmac-sha256-hex>.
 */
export async function fireWebhooks(payload: {
  event: string; deviceId: string | null; hostname: string;
  kind: string; severity: Severity; message: string; ts: string;
}): Promise<void> {
  const subs = await getEnabledSubs();
  const body = JSON.stringify(payload);
  await Promise.allSettled(subs
    .filter(s => webhookMatchesSeverity(payload.severity, s.min_severity as Severity))
    .map(async s => {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (s.secret) {
        headers['x-switchpilot-signature'] =
          'sha256=' + createHmac('sha256', s.secret).update(body).digest('hex');
      }
      // Retry a briefly-down receiver (network error / timeout / 5xx); a 4xx is
      // a permanent misconfiguration and is not retried.
      const r = await fetchWithRetry(s.url, { method: 'POST', headers, body });
      const status = r.ok || r.attempts === 1 ? r.status : `${r.status} (gave up after ${r.attempts} tries)`;
      await query(
        'UPDATE webhook_subscriptions SET last_fired_at=now(), last_status=$1 WHERE id=$2',
        [status, s.id]).catch(() => {});
    }));
}

const jsonReq = (body: unknown): RequestInit => ({
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
});

/** Fire a test message through every CONFIGURED channel and return a per-channel
 *  result, so an operator can verify wiring at setup time instead of waiting for
 *  a real 2am alert. Unconfigured channels are omitted; each is a single attempt
 *  (no retry) so a bad URL fails fast. This is the only way to test the env-var
 *  notifiers (Discord/ntfy/…), which — unlike generic webhooks — send each
 *  service's native payload (a Discord webhook needs {content}, which is why
 *  pointing a *generic* webhook at Discord returns 400). */
export async function testNotifiers(): Promise<{ channel: string; ok: boolean; detail: string }[]> {
  const title = '[SwitchPilot] Test notification';
  const text = 'This is a test from SwitchPilot. If you can read this, the channel is wired up correctly.';
  const out: { channel: string; ok: boolean; detail: string }[] = [];

  const fire = async (channel: string, req: NotifyRequest | null) => {
    if (!req) return;   // channel not configured
    const r = await fetchWithRetry(req.url, req.init, { maxAttempts: 1 });
    out.push({ channel, ok: r.ok, detail: r.status });
  };

  if (config.slackWebhook) await fire('Slack', { url: config.slackWebhook, init: jsonReq({ text: `*${title}*\n${text}` }) });
  if (config.teamsWebhook) await fire('Teams', { url: config.teamsWebhook, init: jsonReq({
    '@type': 'MessageCard', '@context': 'https://schema.org/extensions',
    themeColor: '0078D7', summary: title, title, text }) });
  await fire('Discord', buildDiscord(title, text));
  await fire('ntfy', buildNtfy(title, text, 'info'));
  await fire('Gotify', buildGotify(title, text, 'info'));
  await fire('Telegram', buildTelegram(title, text));
  await fire('Pushover', buildPushover(title, text, 'info'));
  if (config.smtp.host) {
    try { await sendEmail(title, text); out.push({ channel: 'Email', ok: true, detail: 'sent' }); }
    catch (e) { out.push({ channel: 'Email', ok: false, detail: (e as Error).message.slice(0, 120) }); }
  }
  return out;
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
  // fetchWithRetry: a briefly-down collector (restart / blip / 5xx) shouldn't
  // drop a critical alert - retried with backoff like every other channel.
  await fetchWithRetry(config.teamsWebhook, {
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
  await fetchWithRetry(config.slackWebhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: `*${title}*\n${text}` })
  });
}
