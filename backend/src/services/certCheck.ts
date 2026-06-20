// Daily TLS / management-certificate expiry check. Connects to each device's
// management port, reads the presented certificate (no verification - we only
// want the expiry), stores it, and raises/resolves a `cert_expiry` alert.
// Devices that don't complete a TLS handshake are silently skipped, so this is
// safe to run against a mixed fleet where only some devices expose HTTPS.
import tls from 'node:tls';
import { query } from '../db.js';
import { config } from '../config.js';
import { raiseAlert, resolveAlert } from './alertService.js';
import type { DeviceRow } from './deviceComms.js';

export interface CertDecision {
  action: 'raise' | 'resolve';
  severity?: 'warning' | 'critical';
  daysLeft: number;
}

/** Pure: decide the alert action for a cert expiry. Exported for tests. Expired
 *  or within 7 days = critical; within `warnDays` = warning; else resolve. */
export function certDecision(expiry: Date, warnDays: number, now: Date = new Date()): CertDecision {
  const daysLeft = Math.floor((expiry.getTime() - now.getTime()) / 86_400_000);
  if (daysLeft <= 7) return { action: 'raise', severity: 'critical', daysLeft };
  if (daysLeft <= warnDays) return { action: 'raise', severity: 'warning', daysLeft };
  return { action: 'resolve', daysLeft };
}

/** Read the TLS certificate a host presents (no verification). Resolves null if
 *  the host doesn't complete a TLS handshake within the timeout. */
function peekCertExpiry(host: string, port: number, timeoutMs = 6000): Promise<Date | null> {
  return new Promise(resolve => {
    let done = false;
    const finish = (v: Date | null) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch { /* already closed */ }
      resolve(v);
    };
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const cert = socket.getPeerCertificate();
      const exp = cert && cert.valid_to ? new Date(cert.valid_to) : null;
      finish(exp && !Number.isNaN(exp.getTime()) ? exp : null);
    });
    socket.on('timeout', () => finish(null));
    socket.on('error', () => finish(null));
  });
}

/** Check one device's management TLS cert: store its expiry and raise/resolve a
 *  `cert_expiry` alert. A device without TLS clears any stale alert and is left
 *  with its previously stored expiry untouched. */
export async function checkDeviceCert(device: DeviceRow): Promise<void> {
  const host = String(device.mgmt_ip).replace(/\/\d+$/, '');   // strip any CIDR suffix
  const expiry = await peekCertExpiry(host, config.certCheck.port);
  if (!expiry) {
    await resolveAlert(device.id, 'cert_expiry').catch(() => {});
    return;
  }
  await query('UPDATE devices SET cert_expires_at=$1, cert_checked_at=now() WHERE id=$2', [expiry, device.id]);

  const d = certDecision(expiry, config.certCheck.warnDays);
  const name = device.hostname || host;
  const on = expiry.toISOString().slice(0, 10);
  if (d.action === 'resolve') {
    await resolveAlert(device.id, 'cert_expiry').catch(() => {});
  } else if (d.daysLeft < 0) {
    await raiseAlert(device.id, 'cert_expiry', 'critical', `${name} TLS certificate expired ${-d.daysLeft} day(s) ago (${on})`);
  } else {
    await raiseAlert(device.id, 'cert_expiry', d.severity!, `${name} TLS certificate expires in ${d.daysLeft} day(s) (${on})`);
  }
}
