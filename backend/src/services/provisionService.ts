// Builds the baseline config SwitchPilot relies on for full functionality.
// Pushed as a config_push job so it is visible, audited, and retryable.
import { query } from '../db.js';
import { decryptSecret } from '../crypto/secrets.js';
import { createJob } from './jobService.js';

export interface ProvisionPlan {
  lines: string[];
  notes: string[];
}

/**
 * What each line enables:
 *  - lldp run: neighbor discovery for non-Cisco gear (CDP only sees Cisco).
 *    Feeds the Topology page, the device Neighbors tab, and Discovery suggestions.
 *  - logging host / trap: forwards syslog to SwitchPilot's built-in listener,
 *    which raises alerts on link flaps, config changes, errdisable, etc.
 *  - snmp-server community: lets the fast status poll use SNMP instead of a
 *    full SSH connect (only if the credential profile has a v2c community).
 */
/** Pure plan builder - unit-testable without a database. */
export function planFromInputs(input: {
  snmpVersion?: string | null;
  snmpCommunity?: string | null;
  platformUrl?: string;
}): ProvisionPlan {
  const lines: string[] = ['lldp run'];
  const notes: string[] = ['lldp run: discover non-Cisco neighbors (UniFi, servers, APs)'];

  // Hostname only: switch syslog goes to UDP 514 (the platform's listener),
  // not to the HTTP port in PLATFORM_URL - so the port is dropped on purpose.
  const platformHost = (input.platformUrl ?? '').match(/^https?:\/\/([^:/]+)/)?.[1];
  if (platformHost) {
    lines.push(`logging host ${platformHost}`, 'logging trap informational');
    notes.push(`syslog forwarding to ${platformHost} (UDP 514): real-time link/config/errdisable alerts`);
  } else {
    notes.push('PLATFORM_URL not set - skipped syslog forwarding');
  }

  if (input.snmpVersion && input.snmpVersion !== '3') {
    const community = input.snmpCommunity ?? '';
    if (community) {
      // The community is interpolated into an IOS config line - restrict it to a
      // safe charset so a malformed stored value can't smuggle extra commands.
      if (/^[\w.\-]+$/.test(community)) {
        lines.push(`snmp-server community ${community} RO`);
        notes.push('SNMP v2c read-only community: fast status polling without SSH');
      } else {
        notes.push('SNMP community contains characters unsafe for a config line - skipped (use letters, digits, . _ -)');
      }
    }
  } else if (input.snmpVersion === '3') {
    notes.push('credential profile uses SNMPv3 - configure snmp-server user/group manually');
  }

  return { lines, notes };
}

export async function buildProvisionPlan(deviceId: string): Promise<ProvisionPlan> {
  const { rows } = await query(
    `SELECT d.id, d.hostname, c.snmp_version, c.snmp_community_enc
     FROM devices d LEFT JOIN credentials c ON c.id = d.credential_id
     WHERE d.id = $1`, [deviceId]);
  const d = rows[0];
  if (!d) throw Object.assign(new Error('Device not found'), { statusCode: 404 });

  return planFromInputs({
    snmpVersion: d.snmp_version,
    snmpCommunity: d.snmp_community_enc ? decryptSecret(d.snmp_community_enc) : null,
    platformUrl: process.env.PLATFORM_URL
  });
}

/** Queue the baseline as a config_push job. Returns the job and the plan. */
export async function provisionDevice(deviceId: string, createdBy: string) {
  const plan = await buildProvisionPlan(deviceId);
  const job = await createJob({
    type: 'config_push',
    name: 'Baseline provisioning (LLDP, syslog, SNMP)',
    payload: { lines: plan.lines },
    deviceIds: [deviceId],
    scheduleAt: null,
    createdBy
  });
  return { job, ...plan };
}
