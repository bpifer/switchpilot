// Bridges database rows (device + credential) to live device sessions.
// All operations go through the SSH pool: one cached session per device with a
// 90s idle TTL, so back-to-back UI actions and sweeps reuse the handshake.
import crypto from 'node:crypto';
import { query } from '../db.js';
import { redis, publishEvent } from '../redis.js';
import { config } from '../config.js';
import { audit } from '../audit.js';
import { decryptSecret } from '../crypto/secrets.js';
import { type SshTarget } from '../cisco/sshClient.js';
import { makeHostVerifier } from '../cisco/hostKey.js';
import { withDeviceSession, evictDevice } from '../cisco/sshPool.js';
import type { SnmpTarget } from '../cisco/snmpClient.js';
import { driverFor, type PortConfigOpts, type DeviceToolId } from '../drivers/index.js';

export interface DeviceRow {
  id: string;
  hostname: string;
  mgmt_ip: string;
  model: string;
  family: string;
  credential_id: string | null;
  capabilities: Record<string, unknown>;
  ssh_host_key_fp?: string;
  [k: string]: unknown;
}

/** Record a device's SSH host-key fingerprint the first time we see it
 *  (trust-on-first-use). The WHERE guard makes this a no-op once pinned, so
 *  concurrent first connections can't clobber an existing pin. */
async function pinHostKey(deviceId: string, fp: string): Promise<void> {
  try {
    const { rowCount } = await query(
      `UPDATE devices SET ssh_host_key_fp=$1, ssh_host_key_pinned_at=now()
       WHERE id=$2 AND coalesce(ssh_host_key_fp,'')=''`, [fp, deviceId]);
    if (rowCount) await audit('system', 'device.sshkey.pin', deviceId, { fingerprint: fp });
  } catch (err) {
    console.error(`failed to pin SSH host key for ${deviceId}:`, (err as Error).message);
  }
}

/** Audit a host-key mismatch. The connection is already being refused by the
 *  verifier (before auth); this records it as a security event for the timeline. */
async function recordHostKeyMismatch(device: DeviceRow, presented: string, expected: string): Promise<void> {
  try {
    await audit('system', 'device.sshkey.mismatch', device.id,
      { host: device.mgmt_ip, expected, presented });
  } catch (err) {
    console.error(`failed to record SSH host-key mismatch for ${device.id}:`, (err as Error).message);
  }
}

/** Clear a device's pinned SSH host key so the next connection re-pins. Use when
 *  a switch is legitimately re-imaged or replaced (otherwise it would be refused). */
export async function repinHostKey(deviceId: string, username: string): Promise<void> {
  await query(`UPDATE devices SET ssh_host_key_fp='', ssh_host_key_pinned_at=NULL WHERE id=$1`, [deviceId]);
  await audit(username, 'device.sshkey.repin', deviceId, {});
}

export async function getDevice(deviceId: string): Promise<DeviceRow> {
  const { rows } = await query<DeviceRow>('SELECT * FROM devices WHERE id=$1', [deviceId]);
  if (!rows[0]) throw Object.assign(new Error('Device not found'), { statusCode: 404 });
  return rows[0];
}

export async function sshTargetFor(device: DeviceRow): Promise<SshTarget> {
  if (!device.credential_id) throw Object.assign(new Error('Device has no credential profile assigned'), { statusCode: 400 });
  const { rows } = await query('SELECT * FROM credentials WHERE id=$1', [device.credential_id]);
  const c = rows[0];
  if (!c) throw Object.assign(new Error('Credential profile not found'), { statusCode: 400 });
  const driver = driverFor(device);
  return {
    host: device.mgmt_ip,
    username: c.ssh_username,
    password: decryptSecret(c.ssh_password_enc),
    enablePassword: decryptSecret(c.enable_password_enc) || undefined,
    skipEnable: driver.skipEnable,
    os: driver.os,
    // Pin the host key on first connect; refuse a changed key thereafter. Runs
    // for every pooled SSH operation (exec, config push, refresh, terminal).
    hostVerifier: makeHostVerifier({
      expectedFp: device.ssh_host_key_fp ?? '',
      onPin: fp => { void pinHostKey(device.id, fp); },
      onMismatch: (presented, expected) => { void recordHostKeyMismatch(device, presented, expected); }
    })
  };
}

export async function snmpTargetFor(device: DeviceRow): Promise<SnmpTarget | null> {
  if (!device.credential_id) return null;
  const { rows } = await query('SELECT * FROM credentials WHERE id=$1', [device.credential_id]);
  const c = rows[0];
  if (!c) return null;
  if (c.snmp_version === '3') {
    if (!c.snmpv3_user) return null;
    return {
      host: device.mgmt_ip,
      version: '3',
      v3: {
        user: c.snmpv3_user,
        authProtocol: c.snmpv3_auth_proto,
        authKey: decryptSecret(c.snmpv3_auth_key_enc),
        privProtocol: c.snmpv3_priv_proto,
        privKey: decryptSecret(c.snmpv3_priv_key_enc)
      }
    };
  }
  const community = decryptSecret(c.snmp_community_enc);
  if (!community) return null;
  return { host: device.mgmt_ip, version: '2c', community };
}

/** Run show commands on a device by id. */
export async function deviceExec(deviceId: string, commands: string[]): Promise<Record<string, string>> {
  const device = await getDevice(deviceId);
  const target = await sshTargetFor(device);
  return withDeviceSession(target, async session => {
    const results: Record<string, string> = {};
    for (const cmd of commands) results[cmd] = await session.exec(cmd);
    return results;
  });
}

/** Push config lines to an already-fetched device, optionally saving. */
async function pushLines(device: DeviceRow, lines: string[], save: boolean): Promise<string> {
  const target = await sshTargetFor(device);
  return withDeviceSession(target, async session => {
    const output = await session.configure(lines);
    // saveCommand is empty when the OS auto-persists (RouterOS) - skip the step.
    const saveCommand = driverFor(device).saveCommand;
    if (save && saveCommand) await session.saveConfig(saveCommand);
    return output;
  });
}

/** Push configuration lines to a device, optionally saving to startup config. */
export async function devicePushConfig(deviceId: string, lines: string[], save = true): Promise<string> {
  return pushLines(await getDevice(deviceId), lines, save);
}

/** Enable or disable a port (driver-generated config). */
export async function setPortAdmin(deviceId: string, portName: string, enabled: boolean): Promise<string> {
  const device = await getDevice(deviceId);
  return pushLines(device, driverFor(device).setPortAdmin(portName, enabled), false);
}

/** Apply a full port configuration (driver-generated config). */
export async function pushPortConfig(deviceId: string, portName: string, opts: PortConfigOpts): Promise<string> {
  const device = await getDevice(deviceId);
  return pushLines(device, driverFor(device).portConfig(portName, opts), true);
}

/** Set the syslog trap level (driver-generated config). */
export async function setLoggingLevel(deviceId: string, level: string): Promise<string> {
  const device = await getDevice(deviceId);
  return pushLines(device, driverFor(device).loggingTrap(level), true);
}

/** Administratively bounce a port (shutdown / no shutdown). */
export async function bouncePort(deviceId: string, portName: string): Promise<string> {
  const device = await getDevice(deviceId);
  const { down, up } = driverFor(device).bounceLines(portName);
  const target = await sshTargetFor(device);
  return withDeviceSession(target, async session => {
    await session.configure(down);
    await new Promise(r => setTimeout(r, 3000));
    return session.configure(up);
  });
}

/** Power-cycle a PoE port: cut power, pause, restore. Reboots a powered device
 *  (AP/camera/phone) without yanking the cable. */
export async function poeCyclePort(deviceId: string, portName: string): Promise<string> {
  const device = await getDevice(deviceId);
  const { off, on } = driverFor(device).poeCycleLines(portName);
  const target = await sshTargetFor(device);
  return withDeviceSession(target, async session => {
    await session.configure(off);
    await new Promise(r => setTimeout(r, 4000));
    return session.configure(on);
  });
}

/** Run a TDR cable test on a copper port and return results. */
export async function cableTest(deviceId: string, portName: string): Promise<string> {
  const device = await getDevice(deviceId);
  const { run, show } = driverFor(device).cableTest(portName);
  const target = await sshTargetFor(device);
  return withDeviceSession(target, async session => {
    await session.exec(run);
    await new Promise(r => setTimeout(r, 7000)); // TDR takes a few seconds
    return session.exec(show);
  });
}

/** Run a diagnostic tool (ping/traceroute/ip-scan) against a target and return
 *  the raw device output. The driver owns the per-vendor command; continuous
 *  tools (RouterOS traceroute) are time-bounded via the session's execBounded. */
export async function runDeviceTool(
  deviceId: string,
  tool: DeviceToolId,
  opts: { target: string; count: number }
): Promise<string> {
  const device = await getDevice(deviceId);
  const driver = driverFor(device);
  if (!driver.tools.includes(tool)) {
    throw Object.assign(new Error(`${tool} is not supported on ${driver.vendor}`), { statusCode: 501 });
  }
  const cmd = driver.toolCommand(tool, { target: opts.target, count: opts.count });
  const target = await sshTargetFor(device);
  // Time budget: ping scales with probe count; Cisco traceroute self-terminates
  // so allow a full path; RouterOS traceroute streams forever, so keep it short.
  const maxMs =
    tool === 'ping'          ? Math.min(opts.count, 10) * 1500 + 6000 :
    tool === 'ip-scan'       ? 12000 :
    driver.os === 'routeros' ? 12000 : 45000;   // traceroute
  return withDeviceSession(target, async session => {
    const raw = session.execBounded
      ? await session.execBounded(cmd, maxMs)
      : await session.exec(cmd, maxMs);
    // RouterOS streaming tools re-print their table each interval; collapse the
    // stacked frames to the final one (driver-owned, vendor-specific).
    return driver.cleanToolOutput ? driver.cleanToolOutput(tool, raw) : raw;
  });
}

/** Point a device's NetFlow/IPFIX export at the platform collector. Resolves the
 *  collector host from PLATFORM_URL (same as the baseline) and the port from
 *  NETFLOW_PORT, then pushes the driver-generated, idempotent config. */
export async function configureFlowExport(deviceId: string): Promise<string> {
  const host = (process.env.PLATFORM_URL ?? '').match(/^https?:\/\/([^:/]+)/)?.[1];
  if (!host) {
    throw Object.assign(
      new Error('PLATFORM_URL is not set, so the NetFlow collector host is unknown. Set it to a URL the switch can reach.'),
      { statusCode: 400 });
  }
  const device = await getDevice(deviceId);
  // Known port names feed drivers that attach the monitor per interface
  // (Cisco Flexible NetFlow); RouterOS ignores them (global traffic-flow).
  const { rows } = await query<{ name: string }>(
    'SELECT name FROM ports WHERE device_id=$1 ORDER BY name', [deviceId]);
  const lines = driverFor(device).flowExportLines({
    host, port: config.netflow.port, interfaces: rows.map(r => r.name),
    // The device's own IP as the export source (host() strips any CIDR suffix),
    // so RouterOS doesn't emit from 0.0.0.0 and get dropped by a NAT'd collector.
    srcAddress: String(device.mgmt_ip).replace(/\/\d+$/, ''),
  });
  return pushLines(device, lines, true);
}

export interface RevertResult { outcome: 'confirmed' | 'reverting'; output: string; }

/** Push config under a commit-confirm net: arm an auto-revert, apply the change,
 *  then confirm the platform can still reach the device - disarming on success,
 *  or letting the device auto-revert if the change cut us off. RouterOS only. */
export async function pushConfigWithRevert(
  device: DeviceRow, lines: string[], seconds: number
): Promise<RevertResult> {
  const deviceId = device.id;
  const driver = driverFor(device);
  if (!driver.supportsCommitConfirm) {
    throw Object.assign(new Error(`Commit-confirm is not supported on ${driver.vendor}`), { statusCode: 501 });
  }
  // Alphanumeric backup/scheduler name; the random suffix keeps two pushes to
  // the same device from ever sharing a snapshot name (timestamp alone could
  // collide within 1ms if pushes are made concurrent).
  const token = `spcc${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
  const target = await sshTargetFor(device);

  // Arm the revert first, so even a disconnect mid-apply still auto-reverts.
  // Cisco: interactive `reload in N` prompts handled by CiscoSshSession.armRevert.
  // RouterOS: driver generates CLI lines for its backup + scheduler approach.
  await withDeviceSession(target, async session => {
    if (session.armRevert) {
      await session.armRevert(seconds);
    } else {
      await session.configure(driver.armRevertLines({ token, seconds }));
    }
  });

  // Surface the armed window to the UI (redis TTL = the revert timer, so the
  // flag self-clears if we crash or the device reverts). Works across replicas.
  const armedKey = `device:${deviceId}:revertArmed`;
  await redis.set(armedKey, new Date(Date.now() + seconds * 1000).toISOString(), 'EX', seconds).catch(() => {});
  publishEvent({ type: 'device_updated', data: { deviceId } }).catch(() => {});

  let output: string;
  try {
    output = await withDeviceSession(target, session => session.configure(lines));
  } catch (err) {
    // The change likely cut our own session; the revert is armed and will fire.
    evictDevice(target);
    return { outcome: 'reverting', output: `apply error (device will auto-revert): ${(err as Error).message}` };
  }

  // Verify reachability with fresh handshakes (a cut mgmt path must actually fail,
  // not reuse a cached socket), leaving a margin before the revert fires.
  const reachable = await reachableWithin(target, driver.probeCommand, Math.max((seconds - 10) * 1000, 10_000));
  if (!reachable) return { outcome: 'reverting', output };

  // Confirmed reachable - cancel the scheduled revert and persist the change.
  // Cisco: `reload cancel` then `write memory`. RouterOS: remove backup + scheduler.
  await withDeviceSession(target, async session => {
    if (session.disarmRevert) {
      await session.disarmRevert();
      const saveCommand = driver.saveCommand;
      if (saveCommand) await session.saveConfig(saveCommand);
    } else {
      await session.configure(driver.disarmRevertLines(token));
    }
  });
  // Disarmed: clear the armed flag now rather than letting the TTL run out.
  // (On the 'reverting' paths above the key is left to expire with the timer.)
  await redis.del(armedKey).catch(() => {});
  publishEvent({ type: 'device_updated', data: { deviceId } }).catch(() => {});
  return { outcome: 'confirmed', output };
}

/** Probe the device CLI repeatedly until it responds or the budget elapses,
 *  forcing a fresh connection each attempt. */
async function reachableWithin(target: SshTarget, probe: string, budgetMs: number): Promise<boolean> {
  // Short per-probe timeout so a dead device fails fast: the default readyTimeout
  // is 15s, which would swamp the 3s retry cadence. The pool key ignores
  // timeoutMs, so this still reuses/evicts the same device entry.
  const probeTarget = { ...target, timeoutMs: 4000 };
  const start = Date.now();
  for (let attempt = 0; Date.now() - start < budgetMs; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 3000));
    evictDevice(probeTarget);   // drop any cached session so we truly re-handshake
    try {
      await withDeviceSession(probeTarget, session => session.exec(probe, 4000));
      return true;
    } catch { /* not back yet - retry within the budget */ }
  }
  return false;
}

/** Create a link-aggregation group from member ports (driver-generated). */
export async function createLag(
  deviceId: string, opts: { id: string; members: string[]; mode: 'lacp' | 'static' }
): Promise<string> {
  const device = await getDevice(deviceId);
  const driver = driverFor(device);
  if (!driver.supportsLag) throw Object.assign(new Error(`LAG is not supported on ${driver.vendor}`), { statusCode: 501 });
  return pushLines(device, driver.lagCreateLines(opts), true);
}

/** Remove a LAG and return its members to normal switching (driver-generated). */
export async function deleteLag(
  deviceId: string, opts: { id: string; members: string[] }
): Promise<string> {
  const device = await getDevice(deviceId);
  const driver = driverFor(device);
  if (!driver.supportsLag) throw Object.assign(new Error(`LAG is not supported on ${driver.vendor}`), { statusCode: 501 });
  return pushLines(device, driver.lagDeleteLines({ ...opts, mode: 'lacp' }), true);
}
