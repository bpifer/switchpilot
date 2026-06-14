// Builds the baseline config SwitchPilot relies on for full functionality.
// Pushed as a config_push job so it is visible, audited, and retryable.
import { query } from '../db.js';
import { decryptSecret } from '../crypto/secrets.js';
import { createJob } from './jobService.js';
import { driverFor, type DeviceDriver } from '../drivers/index.js';
import { ciscoDriver } from '../drivers/cisco.js';

export interface ProvisionPlan {
  lines: string[];
  notes: string[];
}

/**
 * Pure plan builder - unit-testable without a database. The driver owns the
 * vendor-specific lines (neighbor discovery, syslog forwarding, SNMP); this
 * just resolves the syslog host from PLATFORM_URL and delegates. Defaults to
 * Cisco IOS so existing callers/tests are unchanged.
 *
 * The baseline enables: neighbor discovery (Topology/Neighbors/Discovery),
 * syslog forwarding to SwitchPilot's listener (link/config/errdisable alerts),
 * and an optional SNMP v2c read community (fast status polling without SSH).
 */
export function planFromInputs(input: {
  snmpVersion?: string | null;
  snmpCommunity?: string | null;
  platformUrl?: string;
}, driver: DeviceDriver = ciscoDriver('ios')): ProvisionPlan {
  // Hostname only: switch syslog goes to UDP 514 (the platform's listener),
  // not to the HTTP port in PLATFORM_URL - so the port is dropped on purpose.
  const platformHost = (input.platformUrl ?? '').match(/^https?:\/\/([^:/]+)/)?.[1] ?? null;
  return driver.baseline({
    snmpVersion: input.snmpVersion,
    snmpCommunity: input.snmpCommunity,
    platformHost,
  });
}

export async function buildProvisionPlan(deviceId: string): Promise<ProvisionPlan> {
  const { rows } = await query(
    `SELECT d.id, d.hostname, d.vendor, d.capabilities, c.snmp_version, c.snmp_community_enc
     FROM devices d LEFT JOIN credentials c ON c.id = d.credential_id
     WHERE d.id = $1`, [deviceId]);
  const d = rows[0];
  if (!d) throw Object.assign(new Error('Device not found'), { statusCode: 404 });

  return planFromInputs({
    snmpVersion: d.snmp_version,
    snmpCommunity: d.snmp_community_enc ? decryptSecret(d.snmp_community_enc) : null,
    platformUrl: process.env.PLATFORM_URL
  }, driverFor(d));
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
