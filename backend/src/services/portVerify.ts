// Post-change read-back: after a port edit we re-read the port's effective
// config from the device and confirm the intended change actually landed,
// instead of trusting the optimistic local update. Catches silently-rejected
// or partially-applied edits (e.g. a command refused mid-push).
import { deviceExec, getDevice } from './deviceComms.js';
import { driverFor, type PortConfigOpts } from '../drivers/index.js';

export interface PortMismatch { field: string; expected: string; actual: string; }
export interface PortVerification {
  ok: boolean;          // no concrete mismatch found
  checked: boolean;     // false = the driver has no single-port read-back (skipped)
  confirmed: string[];  // fields the device confirms match the intent
  mismatches: PortMismatch[];
}

/**
 * Compare a Cisco running-config interface block against the intended edit.
 * Only fields that appear deterministically in running-config are checked;
 * a field the block doesn't show is left unconfirmed (not a mismatch) to avoid
 * false alarms on platform defaults. Pure — unit-tested directly.
 */
export function verifyPortIntent(block: string, intent: PortConfigOpts): Omit<PortVerification, 'checked'> {
  const b = block.replace(/\r/g, '');
  const find = (re: RegExp) => b.match(re)?.[1]?.trim();
  const isTrunk = /^\s*switchport mode trunk/m.test(b);
  const confirmed: string[] = [];
  const mismatches: PortMismatch[] = [];
  const check = (field: string, expected: string, actual: string | undefined) => {
    if (actual === undefined) return;            // device didn't show it -> unconfirmed
    if (actual === expected) confirmed.push(field);
    else mismatches.push({ field, expected, actual });
  };

  if (intent.description !== undefined) {
    // An absent description line means it's cleared, so treat absence as ''.
    check('description', intent.description.trim(), find(/^\s*description (.+)$/m) ?? '');
  }
  if (intent.mode) {
    check('mode', intent.mode, find(/^\s*switchport mode (\w+)/m));
  }
  // access vlan 1 is the default and omitted from running-config; absence -> '1'.
  // Skip on a trunk port, where an access vlan line wouldn't appear anyway.
  if (intent.vlan !== undefined && intent.mode !== 'trunk' && !isTrunk) {
    check('access vlan', String(intent.vlan), find(/^\s*switchport access vlan (\d+)/m) ?? '1');
  }
  if (intent.voiceVlan !== undefined) {
    check('voice vlan', String(intent.voiceVlan), find(/^\s*switchport voice vlan (\d+)/m));
  }
  if (intent.trunkNativeVlan !== undefined) {
    check('trunk native vlan', String(intent.trunkNativeVlan), find(/^\s*switchport trunk native vlan (\d+)/m) ?? '1');
  }

  return { ok: mismatches.length === 0, confirmed, mismatches };
}

/** Read the port's effective config back from the device and verify it matches
 *  the intended edit. checked:false when the driver has no read-back (RouterOS). */
export async function verifyPortConfig(deviceId: string, port: string, intent: PortConfigOpts): Promise<PortVerification> {
  const cmd = driverFor(await getDevice(deviceId)).portReadbackCommand(port);
  if (!cmd) return { ok: true, checked: false, confirmed: [], mismatches: [] };
  const out = await deviceExec(deviceId, [cmd]);
  return { checked: true, ...verifyPortIntent(Object.values(out)[0] ?? '', intent) };
}
