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
export async function buildProvisionPlan(deviceId: string): Promise<ProvisionPlan> {
  const { rows } = await query(
    `SELECT d.id, d.hostname, c.snmp_version, c.snmp_community_enc
     FROM devices d LEFT JOIN credentials c ON c.id = d.credential_id
     WHERE d.id = $1`, [deviceId]);
  const d = rows[0];
  if (!d) throw Object.assign(new Error('Device not found'), { statusCode: 404 });

  const lines: string[] = ['lldp run'];
  const notes: string[] = ['lldp run: discover non-Cisco neighbors (UniFi, servers, APs)'];

  const platformHost = (process.env.PLATFORM_URL ?? '').match(/^https?:\/\/([^:/]+)/)?.[1];
  if (platformHost) {
    lines.push(`logging host ${platformHost}`, 'logging trap informational');
    notes.push(`syslog forwarding to ${platformHost}: real-time link/config/errdisable alerts`);
  } else {
    notes.push('PLATFORM_URL not set - skipped syslog forwarding');
  }

  if (d.snmp_version && d.snmp_version !== '3') {
    const community = decryptSecret(d.snmp_community_enc ?? '');
    if (community) {
      lines.push(`snmp-server community ${community} RO`);
      notes.push('SNMP v2c read-only community: fast status polling without SSH');
    }
  } else if (d.snmp_version === '3') {
    notes.push('credential profile uses SNMPv3 - configure snmp-server user/group manually');
  }

  return { lines, notes };
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
