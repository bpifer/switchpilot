// Tracks a device's firmware-update state in redis so the UI can show "update
// in progress" during the reboot instead of a bare "offline". Set when
// SwitchPilot stages/reboots an update, and reconciled from the device's own
// package-update status on each sweep so an externally-triggered update
// (someone rebooting from Winbox) is surfaced too. Mirrors the commit-confirm
// armed-flag pattern: a self-clearing redis key, works across replicas.
import { redis } from '../redis.js';

export type FwUpdateState = 'downloaded' | 'installing';
export interface FwUpdate {
  state: FwUpdateState;   // downloaded = staged, awaiting reboot; installing = rebooting to apply
  version: string;        // target version (best known)
  since: string;          // ISO time the state was first entered
}

const key = (deviceId: string) => `device:${deviceId}:fwUpdate`;

export async function getFwUpdate(deviceId: string): Promise<FwUpdate | null> {
  try {
    const v = await redis.get(key(deviceId));
    return v ? (JSON.parse(v) as FwUpdate) : null;
  } catch { return null; }
}

/** Set/refresh the flag. `since` is preserved across state changes so the UI can
 *  show how long an update has been running. */
export async function setFwUpdate(deviceId: string, state: FwUpdateState, version: string, ttlSec: number): Promise<void> {
  try {
    const prev = await getFwUpdate(deviceId);
    const since = prev?.since ?? new Date().toISOString();
    const ver = version || prev?.version || '';
    await redis.set(key(deviceId), JSON.stringify({ state, version: ver, since }), 'EX', ttlSec);
  } catch { /* redis best-effort */ }
}

export async function clearFwUpdate(deviceId: string): Promise<void> {
  try { await redis.del(key(deviceId)); } catch { /* best-effort */ }
}
