// Bridges database rows (device + credential) to live device sessions.
// All operations go through the SSH pool: one cached session per device with a
// 90s idle TTL, so back-to-back UI actions and sweeps reuse the handshake.
import { query } from '../db.js';
import { decryptSecret } from '../crypto/secrets.js';
import { type SshTarget } from '../cisco/sshClient.js';
import { withDeviceSession } from '../cisco/sshPool.js';
import type { SnmpTarget } from '../cisco/snmpClient.js';
import { driverFor, type PortConfigOpts } from '../drivers/index.js';

export interface DeviceRow {
  id: string;
  hostname: string;
  mgmt_ip: string;
  model: string;
  family: string;
  credential_id: string | null;
  capabilities: Record<string, unknown>;
  [k: string]: unknown;
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
  return {
    host: device.mgmt_ip,
    username: c.ssh_username,
    password: decryptSecret(c.ssh_password_enc),
    enablePassword: decryptSecret(c.enable_password_enc) || undefined,
    skipEnable: driverFor(device).skipEnable
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
    if (save) await session.saveConfig(driverFor(device).saveCommand);
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
