// Device diagnostics bundle: the raw command/SNMP output SwitchPilot sees,
// packaged as one redacted text file an operator can attach to a bug report.
// Most parser bugs on unfamiliar hardware are fixable from this bundle alone -
// it captures exactly the inputs the monitor parses, without needing access
// to the reporter's devices.
//
// Read-only by construction: the command lists below contain no config-mode
// commands, and every section is passed through redactForAudit so passwords,
// secrets, and SNMP communities never leave the box.
import { createRequire } from 'node:module';
import { redactForAudit } from '../audit.js';
import { getDevice, sshTargetFor, snmpTargetFor, type DeviceRow } from './deviceComms.js';
import { withDeviceSession } from '../cisco/sshPool.js';
import { snmpGet, snmpWalk } from '../cisco/snmpClient.js';
import { ARUBA_OIDS } from '../aruba/snmp.js';

const require = createRequire(import.meta.url);
function appVersion(): string {
  try { return require('../../package.json').version ?? 'unknown'; }
  catch { return 'unknown'; }
}

/** Read-only commands per vendor, mirroring what the monitors parse.
 *  Pure; exported for tests (which assert nothing here can change config). */
export function diagnosticCommands(vendor: string, os: string): string[] {
  if (vendor === 'mikrotik') {
    return [
      '/system resource print',
      '/system routerboard print',
      '/system identity print',
      '/system health print',
      '/system package update print',
      '/interface print terse',
      '/interface bridge host print terse',
      '/interface bridge vlan print terse',
      '/ip neighbor print terse',
      '/snmp print',
    ];
  }
  // Cisco IOS / IOS-XE / NX-OS (superset; unsupported variants just error into
  // their section, which is itself useful signal)
  return [
    'show version',
    'show processes cpu | include CPU utilization',
    os === 'nxos' ? 'show system resources | include Memory' : 'show processes memory | include Processor',
    os === 'nxos' ? 'show environment' : os === 'iosxe' ? 'show environment all' : 'show env all',
    'show switch',
    'show interfaces status',
    'show mac address-table',
    'show power inline',
    'show interfaces | include (line protocol|input errors|output errors|minute rate)',
    'show vlan brief',
    'show cdp neighbors detail',
    'show lldp neighbors detail',
  ];
}

/** SNMP subtrees for an Aruba bundle - the walks the monitor + write layer use. */
export const ARUBA_DIAG_WALKS: Record<string, string> = {
  ifType: ARUBA_OIDS.ifType,
  ifName: ARUBA_OIDS.ifName,
  ifAlias: ARUBA_OIDS.ifAlias,
  ifHighSpeed: ARUBA_OIDS.ifHighSpeed,
  ifAdminStatus: ARUBA_OIDS.ifAdminStatus,
  ifOperStatus: ARUBA_OIDS.ifOperStatus,
  dot1dBasePortIfIndex: ARUBA_OIDS.dot1dBasePortIfIndex,
  dot1qPvid: ARUBA_OIDS.dot1qPvid,
  lldpRemSysName: ARUBA_OIDS.lldpRemSysName,
};

export interface DiagSection { title: string; body: string }

/** Assemble the bundle text. Pure; every body is redacted + size-capped here
 *  so no collection path can forget to. */
export function renderDiagnostics(
  device: Pick<DeviceRow, 'hostname' | 'mgmt_ip' | 'model' | 'family' | 'capabilities'> & {
    vendor?: string; ios_version?: string; serial_number?: string;
  },
  sections: DiagSection[],
): string {
  const lines: string[] = [
    '=== SwitchPilot diagnostics bundle ===',
    `generated : ${new Date().toISOString()}`,
    `version   : ${appVersion()}`,
    '',
    '--- device ---',
    `hostname  : ${device.hostname}`,
    `vendor    : ${device.vendor ?? 'cisco'}`,
    `model     : ${device.model}`,
    `family    : ${device.family}`,
    `os version: ${device.ios_version ?? ''}`,
    `serial    : ${device.serial_number ?? ''}`,
    `mgmt ip   : ${device.mgmt_ip}`,
    `capabilities: ${JSON.stringify(device.capabilities ?? {})}`,
    '',
    'Passwords, secrets, and SNMP communities are redacted. Review before',
    'sharing if your device output contains anything else you consider private.',
    '',
  ];
  for (const s of sections) {
    lines.push(`${'='.repeat(70)}`, `$ ${s.title}`, `${'='.repeat(70)}`,
      redactForAudit(s.body, 30000) || '(no output)', '');
  }
  return lines.join('\n');
}

/** Collect + render a device's diagnostics. Per-section failures are captured
 *  as the section body - a command erroring on some platform is exactly the
 *  signal a bug report needs, and must not sink the rest of the bundle. */
export async function collectDiagnostics(deviceId: string): Promise<{ filename: string; content: string }> {
  const device = await getDevice(deviceId);
  const vendor = (device as any).vendor ?? 'cisco';
  const sections: DiagSection[] = [];

  if (vendor === 'aruba') {
    const target = await snmpTargetFor(device);
    if (!target) throw Object.assign(new Error('No SNMP credential configured on this device'), { statusCode: 400 });
    const sys = await snmpGet(target, [ARUBA_OIDS.sysDescr, ARUBA_OIDS.sysName, ARUBA_OIDS.sysUpTime])
      .catch(err => ({ error: (err as Error).message } as Record<string, string | number>));
    sections.push({
      title: 'SNMP GET system (sysDescr / sysName / sysUpTime)',
      body: Object.entries(sys).map(([k, v]) => `${k} = ${v}`).join('\n'),
    });
    for (const [name, base] of Object.entries(ARUBA_DIAG_WALKS)) {
      const body = await snmpWalk(target, base)
        .then(rows => Object.entries(rows).map(([oid, v]) => `${oid} = ${v}`).join('\n'))
        .catch(err => `WALK FAILED: ${(err as Error).message}`);
      sections.push({ title: `SNMP WALK ${name} (${base})`, body });
    }
  } else {
    const os = ((device.capabilities as any)?.os as string) ?? 'ios';
    const target = await sshTargetFor(device);
    await withDeviceSession(target, async session => {
      for (const cmd of diagnosticCommands(vendor, os)) {
        const body = await session.exec(cmd).catch(err => `COMMAND FAILED: ${(err as Error).message}`);
        sections.push({ title: cmd, body });
      }
    });
  }

  const safeName = (device.hostname || device.mgmt_ip).replace(/[^\w.-]+/g, '_');
  return {
    filename: `switchpilot-diag-${safeName}-${new Date().toISOString().slice(0, 10)}.txt`,
    content: renderDiagnostics(device as any, sections),
  };
}
