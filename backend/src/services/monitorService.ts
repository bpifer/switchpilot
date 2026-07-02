// Vendor-neutral monitoring entry points: the fast reachability poll and the
// full-refresh dispatcher. The actual read paths live in the per-vendor
// monitors (ciscoMonitor, routerosMonitor); shared decision logic (health
// alerts, flap detection, name normalization) lives in monitorShared.
import { query } from '../db.js';
import { publishEvent } from '../redis.js';
import { CiscoSshSession } from '../cisco/sshClient.js';
import { RouterOsSshSession } from '../routeros/sshClient.js';
import { refreshRouterOsDevice, isMikrotik } from './routerosMonitor.js';
import { refreshCiscoDevice } from './ciscoMonitor.js';
import { publishDevice } from './mqttService.js';
import { snmpProbe } from '../cisco/snmpClient.js';
import { getDevice, sshTargetFor, snmpTargetFor, type DeviceRow } from './deviceComms.js';
import { raiseAlert, resolveAlert } from './alertService.js';
import { runAutomationTrigger } from './automationService.js';

// Re-exported so existing importers (tests, routes) keep one import site for
// the monitoring decision logic.
export {
  evaluateHealth, decidePortFlap, shortName,
  type HealthAlert, type PortFlapPrev,
} from './monitorShared.js';

/** Lightweight reachability check (SNMP first, cheap). Marks online/offline. */
export async function pollStatus(device: DeviceRow): Promise<void> {
  const snmpT = await snmpTargetFor(device);
  let reachable = false;
  if (snmpT) {
    const probe = await snmpProbe(snmpT);
    if (probe) {
      reachable = true;
      await query('UPDATE devices SET uptime_seconds=$1 WHERE id=$2', [probe.uptimeSeconds, device.id]);
    }
  }
  if (!reachable) {
    // fall back to a quick SSH connect (vendor-specific session class)
    try {
      const t = { ...(await sshTargetFor(device)), timeoutMs: 8000 };
      const session = isMikrotik(device) ? new RouterOsSshSession(t) : new CiscoSshSession(t);
      await session.connect();
      session.close();
      reachable = true;
    } catch { /* unreachable */ }
  }

  const newStatus = reachable ? 'online' : 'offline';
  // Push the flip to connected dashboards (only on change - polls are frequent).
  if (device.status !== newStatus) {
    publishEvent({ type: 'device_updated', data: { deviceId: device.id } }).catch(() => {});
  }
  // Per-device availability rollup: bump the current hour's up/total counters so
  // availability % over a window is a cheap aggregate. Best-effort.
  await query(
    `INSERT INTO device_availability (device_id, hour, up, total)
     VALUES ($1, date_trunc('hour', now()), $2, 1)
     ON CONFLICT (device_id, hour)
     DO UPDATE SET up = device_availability.up + $2, total = device_availability.total + 1`,
    [device.id, reachable ? 1 : 0]).catch(() => { /* availability is best-effort */ });
  if (device.status !== newStatus) {
    await query('UPDATE devices SET status=$1, last_seen_at=CASE WHEN $1=\'online\' THEN now() ELSE last_seen_at END WHERE id=$2',
      [newStatus, device.id]);
    if (newStatus === 'offline') {
      await raiseAlert(device.id, 'device_offline', 'critical', `${device.hostname} is unreachable via SNMP and SSH`);
      await runAutomationTrigger('device_offline', { deviceId: device.id });
    } else {
      await resolveAlert(device.id, 'device_offline');
    }
  } else if (reachable) {
    await query('UPDATE devices SET last_seen_at=now() WHERE id=$1', [device.id]);
  }
  publishDevice(device.id).catch(() => { /* mqtt best-effort */ });
}

/** Full refresh: identity, metrics, environment, ports, PoE, MACs, stack,
 *  neighbors. Dispatches to the device's vendor monitor. */
export async function refreshDevice(deviceId: string): Promise<void> {
  const device = await getDevice(deviceId);
  if (isMikrotik(device)) await refreshRouterOsDevice(deviceId);
  else await refreshCiscoDevice(device);
  // Notify connected dashboards that this device's inventory/port data changed,
  // so open pages refetch immediately instead of waiting out their poll interval.
  publishEvent({ type: 'device_updated', data: { deviceId } }).catch(() => {});
}
