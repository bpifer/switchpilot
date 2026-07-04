// RouterOS firmware: read the two firmware layers (the RouterOS package + the
// RouterBOARD bootloader firmware) and stage/apply upgrades. Deliberately
// STAGED and safe by default - the only disruptive step (a reboot, which applies
// a staged package or routerboard firmware) is its own explicit action, never
// automatic. All fixed command strings (no user input, no injection surface).
import { audit, redactForAudit } from '../audit.js';
import { withDeviceSession, evictDevice } from '../cisco/sshPool.js';
import { getDevice, sshTargetFor } from './deviceComms.js';
import { isMikrotik } from './routerosMonitor.js';
import { setFwUpdate } from './firmwareState.js';
import { publishEvent } from '../redis.js';
import { parseResource, parseRouterboard, parsePackageUpdate, parseKeyValue, parseSize } from '../routeros/parsers.js';

function assertMikrotik(device: { vendor?: string; capabilities?: unknown }): void {
  if (!isMikrotik(device as any)) {
    throw Object.assign(new Error('RouterOS firmware operations apply to MikroTik devices only'), { statusCode: 501 });
  }
}

export interface RouterosFirmwareStatus {
  version: string;              // installed RouterOS version
  architecture: string;
  channel: string;             // update train (stable/testing/…)
  latestVersion: string;       // newest on the channel ('' if unknown/none)
  updateStatus: string;        // human status from the updater
  osUpdateAvailable: boolean;  // a newer RouterOS package exists on the channel
  updateDownloaded: boolean;   // the update is downloaded + staged (reboot to apply)
  routerboardModel: string;
  currentFirmware: string;     // installed bootloader firmware
  upgradeFirmware: string;     // bootloader firmware bundled with the OS
  routerboardUpgradeAvailable: boolean;   // bootloader is behind the bundled one
  freeHddBytes: number;        // free storage - a package won't download without room
  totalHddBytes: number;
  lowDiskForUpdate: boolean;   // an OS update is available but free space looks too small to download it
}

// A RouterOS package is ~15-20 MB; flag when free storage clearly can't hold one
// (the CRS3xx small-flash gotcha - the download silently fails on "no space").
const MIN_UPDATE_FREE_BYTES = 20 * 1024 * 1024;

/** Read both firmware layers. check-for-updates contacts MikroTik's servers to
 *  learn the latest version; it's best-effort (a device with no internet still
 *  returns the installed version + routerboard state). Read-only. */
export async function getRouterosFirmware(deviceId: string): Promise<RouterosFirmwareStatus> {
  const device = await getDevice(deviceId);
  assertMikrotik(device);
  const target = await sshTargetFor(device);
  return withDeviceSession(target, async session => {
    const resourceRaw = await session.exec('/system resource print');
    const resource = parseResource(resourceRaw);
    const rkv = parseKeyValue(resourceRaw);
    const freeHddBytes = parseSize(rkv['free-hdd-space']);
    const totalHddBytes = parseSize(rkv['total-hdd-space']);
    const routerboard = parseRouterboard(await session.exec('/system routerboard print').catch(() => ''));
    // check-for-updates can be slow / fail offline; fall back to the cached print.
    const updateRaw = await session.exec('/system package update check-for-updates')
      .catch(() => '')
      || await session.exec('/system package update print').catch(() => '');
    const upd = parsePackageUpdate(updateRaw);

    const osUpdateAvailable = !!upd.latestVersion && upd.latestVersion !== resource.version;
    const updateDownloaded = /reboot|downloaded/i.test(upd.status);
    const rbUpgrade = routerboard.upgradeFirmware;
    const rbCurrent = routerboard.currentFirmware;
    return {
      version: resource.version,
      architecture: resource.architecture,
      channel: upd.channel,
      latestVersion: upd.latestVersion,
      updateStatus: upd.status,
      osUpdateAvailable,
      updateDownloaded,
      routerboardModel: routerboard.model,
      currentFirmware: rbCurrent,
      upgradeFirmware: rbUpgrade,
      routerboardUpgradeAvailable: !!rbUpgrade && !!rbCurrent && rbUpgrade !== rbCurrent,
      freeHddBytes,
      totalHddBytes,
      lowDiskForUpdate: osUpdateAvailable && !updateDownloaded && freeHddBytes > 0 && freeHddBytes < MIN_UPDATE_FREE_BYTES,
    };
  });
}

/** Download the newest RouterOS package for this channel WITHOUT installing it.
 *  Non-disruptive: the package is fetched and staged; it installs on the next
 *  reboot. Returns the updater's output. */
export async function downloadRouterosPackage(deviceId: string, by: string, ip = ''): Promise<string> {
  const device = await getDevice(deviceId);
  assertMikrotik(device);
  const target = await sshTargetFor(device);
  const { out, latest } = await withDeviceSession(target, async session => {
    const o = await session.exec('/system package update download');
    // Capture the target version so the "reboot to apply / installing" UI can name it.
    const upd = parsePackageUpdate(await session.exec('/system package update print').catch(() => ''));
    return { out: o, latest: upd.latestVersion };
  });
  // Staged (downloaded, awaiting reboot). Long TTL - it stays until reboot.
  await setFwUpdate(deviceId, 'downloaded', latest, 86400);
  publishEvent({ type: 'device_updated', data: { deviceId } }).catch(() => {});
  await audit(by, 'firmware.routeros.download', deviceId, { output: redactForAudit(out) }, ip);
  return out;
}

/** Stage the bundled RouterBOARD bootloader-firmware upgrade WITHOUT rebooting.
 *  Non-disruptive: the firmware is written and applied on the next reboot. */
export async function stageRouterboardUpgrade(deviceId: string, by: string, ip = ''): Promise<string> {
  const device = await getDevice(deviceId);
  assertMikrotik(device);
  const target = await sshTargetFor(device);
  const { out, upgrade } = await withDeviceSession(target, async session => {
    const o = await session.exec('/system routerboard upgrade');
    const rb = parseRouterboard(await session.exec('/system routerboard print').catch(() => ''));
    return { out: o, upgrade: rb.upgradeFirmware };
  });
  await setFwUpdate(deviceId, 'downloaded', upgrade, 86400);
  publishEvent({ type: 'device_updated', data: { deviceId } }).catch(() => {});
  await audit(by, 'firmware.routerboard.stage', deviceId, { output: redactForAudit(out) }, ip);
  return out;
}

/** Reboot the device to APPLY any staged package/routerboard upgrade. Disruptive
 *  (the device drops for a minute or two) - callers must confirm. The reboot
 *  cuts our own SSH session, so a mid-command disconnect is the expected success
 *  signal; the pooled session is evicted so the next call reconnects. */
export async function rebootRouterosDevice(deviceId: string, by: string, ip = ''): Promise<void> {
  const device = await getDevice(deviceId);
  assertMikrotik(device);
  const target = await sshTargetFor(device);
  // Mark "installing" up front (preserves the target version from the staged
  // flag) so the device page shows the update in progress the moment it drops.
  await setFwUpdate(deviceId, 'installing', '', 900);
  publishEvent({ type: 'device_updated', data: { deviceId } }).catch(() => {});
  await audit(by, 'firmware.routeros.reboot', deviceId, {}, ip);
  try {
    await withDeviceSession(target, session => session.exec('/system reboot'));
  } catch {
    // The reboot dropped the session before it could reply - expected.
  } finally {
    evictDevice(target);
  }
}
