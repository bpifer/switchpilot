import { runCommands, type SshTarget } from './sshClient.js';
import { snmpGet, snmpProbe, OIDS, type SnmpTarget } from './snmpClient.js';
import { parseShowVersion } from './parsers.js';
import { familyForModel, resolveCapabilities } from './capabilities.js';
import { detectAruba } from '../aruba/snmp.js';

export interface DetectionResult {
  hostname: string;
  model: string;
  family: string | null;
  serial: string;
  iosVersion: string;
  uptimeSeconds: number;
  detectedVia: 'ssh' | 'snmp';
  capabilities: Record<string, unknown>;
  /** Set when SNMP identifies a non-Cisco vendor (e.g. 'aruba'); routes the
   *  device to the right monitor from the first refresh. */
  vendor?: string;
}

/**
 * Auto-detect a switch's identity. Tries SSH (`show version`) first because it
 * yields the richest data, then falls back to SNMP (sysDescr + ENTITY-MIB).
 */
export async function detectDevice(
  ssh: SshTarget | null,
  snmpTarget: SnmpTarget | null
): Promise<DetectionResult> {
  if (ssh) {
    try {
      const out = await runCommands(ssh, ['show version']);
      const v = parseShowVersion(out['show version']);
      if (v.model) {
        return {
          ...v,
          family: familyForModel(v.model),
          detectedVia: 'ssh',
          capabilities: resolveCapabilities(v.model, v.iosVersion)
        };
      }
    } catch (err) {
      console.warn(`SSH detection failed for ${ssh.host}: ${(err as Error).message}`);
    }
  }

  if (snmpTarget) {
    const probe = await snmpProbe(snmpTarget);
    if (probe) {
      let model = '';
      let serial = '';
      try {
        // entPhysicalModelName.1000 / .1 cover most Catalyst chassis indexes
        const ent = await snmpGet(snmpTarget, [
          `${OIDS.entPhysicalModelName}.1000`, `${OIDS.entPhysicalSerialNum}.1000`
        ]).catch(() => snmpGet(snmpTarget, [
          `${OIDS.entPhysicalModelName}.1`, `${OIDS.entPhysicalSerialNum}.1`
        ]));
        const vals = Object.values(ent).map(String);
        model = vals[0] ?? '';
        serial = vals[1] ?? '';
      } catch { /* ENTITY-MIB not available */ }
      // Aruba Instant On: SNMP-only management (phase 1). Tag the vendor so the
      // dispatcher sends refreshes to the SNMP monitor, not the Cisco SSH path.
      const aruba = detectAruba(probe.sysDescr);
      if (aruba.isAruba) {
        return {
          hostname: probe.sysName.split('.')[0],
          model: model || aruba.model,
          family: 'aruba-instanton',
          serial,
          iosVersion: aruba.version,
          uptimeSeconds: probe.uptimeSeconds,
          detectedVia: 'snmp',
          vendor: 'aruba',
          capabilities: { os: 'aos-instanton', transport: 'snmp' }
        };
      }
      const iosVersion = probe.sysDescr.match(/Version\s+([\w.():]+?)[,\s]/)?.[1] ?? '';
      return {
        hostname: probe.sysName.split('.')[0],
        model,
        family: model ? familyForModel(model) : null,
        serial,
        iosVersion,
        uptimeSeconds: probe.uptimeSeconds,
        detectedVia: 'snmp',
        capabilities: model ? resolveCapabilities(model, iosVersion) : {}
      };
    }
  }

  throw new Error('Device unreachable via SSH and SNMP — check IP, credentials, and ACLs');
}
