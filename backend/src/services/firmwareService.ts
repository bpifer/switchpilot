import { query } from '../db.js';
import { CiscoSshSession } from '../cisco/sshClient.js';
import { evictDevice } from '../cisco/sshPool.js';
import { getDevice, sshTargetFor } from './deviceComms.js';
import { commandsForFamily } from '../cisco/capabilities.js';
import { raiseAlert } from './alertService.js';

/**
 * Upgrade a device to a registered firmware image.
 *
 * The image must already be retrievable by the switch (the platform exposes
 * uploaded images over HTTP at /api/firmware/files/<filename> — switches copy
 * via `copy http://<platform>/... flash:`). Flow:
 *   1. copy image to flash, 2. verify MD5, 3. set boot (or install add on IOS-XE),
 *   4. reload. Rollback = boot statement still lists the previous image.
 */
export async function upgradeFirmware(
  deviceId: string,
  imageId: string,
  onStage: (stage: string) => Promise<void> = async () => {}
): Promise<string> {
  const device = await getDevice(deviceId);
  const { rows } = await query('SELECT * FROM firmware_images WHERE id=$1', [imageId]);
  const image = rows[0];
  if (!image) throw new Error('Firmware image not found');
  if (image.family !== device.family) {
    throw new Error(`Image is for ${image.family}, device is ${device.family}`);
  }

  const platformUrl = process.env.PLATFORM_URL ?? '';
  if (!platformUrl) throw new Error('PLATFORM_URL must be set so switches can download images');
  const url = `${platformUrl}/api/firmware/files/${image.filename}`;
  const sizeMb = (image.size_bytes / 1024 / 1024).toFixed(1);

  // Dedicated (un-pooled) session: the reload at the end drops the connection.
  const target = await sshTargetFor(device);
  const session = new CiscoSshSession({ ...target, timeoutMs: 30000 });
  await session.connect();
  const log: string[] = [];
  try {
    await session.enable();

    // Suppress interactive file prompts ("Destination filename?", overwrite
    // confirmations) - without this the copy deadlocks waiting for Enter.
    await session.configure(['file prompt quiet']);

    // --- preflight: is the image already there? is there room for it? ---
    await onStage('checking flash');
    let dirOut = await session.exec('dir flash:');
    const fileRe = new RegExp(`\\s${image.filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');
    let needCopy = true;

    if (fileRe.test(dirOut)) {
      await onStage('image already on flash - verifying MD5');
      const v = await session.exec(`verify /md5 flash:${image.filename} ${image.md5}`, 600_000);
      if (/Verified/i.test(v)) {
        log.push(`${image.filename} already on flash with matching MD5 - copy skipped`);
        needCopy = false;
      } else {
        log.push('existing file failed MD5 - deleting and re-copying');
        await session.exec(`delete /force flash:${image.filename}`);
        dirOut = await session.exec('dir flash:');
      }
    }

    if (needCopy) {
      const free = parseInt(dirOut.match(/\((\d+) bytes free\)/)?.[1] ?? '0', 10);
      if (free < image.size_bytes) {
        throw new Error(
          `Not enough flash space: image needs ${sizeMb} MB, only ${(free / 1024 / 1024).toFixed(1)} MB free. ` +
          `Delete unused images from flash: (dir flash: / delete flash:<file>) and retry.`);
      }

      await onStage(`copying image (${sizeMb} MB over HTTP - several minutes)`);
      const copyOut = await session.exec(`copy ${url} flash:${image.filename}`, 1800_000);
      log.push(copyOut);
      if (/%Error|%Warning|failed/i.test(copyOut) && !/bytes copied|\[OK/i.test(copyOut)) {
        throw new Error(`Image copy failed:\n${copyOut}`);
      }

      await onStage('verifying MD5 (a few minutes on older switches)');
      const verify = await session.exec(`verify /md5 flash:${image.filename} ${image.md5}`, 600_000);
      log.push(verify);
      if (!/Verified/i.test(verify)) throw new Error(`MD5 verification failed:\n${verify}`);
    }

    const caps = device.capabilities as any;
    if (caps?.installMode) {
      await onStage('install add/activate/commit (device reloads during this step)');
      const cmd = (commandsForFamily(device.family).installAdd ?? 'install add file flash:{file} activate commit')
        .replace('{file}', image.filename);
      log.push(await session.exec(cmd, 2400_000)); // install mode reloads as part of activate
    } else {
      await onStage('setting boot statement and saving config');
      // Replace any existing boot statements so the switch can't boot the old image
      await session.configure(['no boot system', `boot system flash:${image.filename}`, 'no file prompt quiet']);
      await session.saveConfig();
      log.push('boot statement updated and config saved; issuing reload');
      // Warn operators before the device drops (live via WS alert feed)
      await raiseAlert(deviceId, 'firmware_reload', 'warning',
        `${device.hostname} is reloading NOW to apply ${image.version} - expect 5-10 minutes of downtime`)
        .catch(() => { /* alert is best-effort */ });
      await onStage('reloading device (5-10 min downtime)');
      log.push(await session.reload());
      evictDevice(target);   // any pooled session to this device just died
    }
    return log.join('\n---\n');
  } finally {
    session.close();
  }
}

/** Firmware compliance report: device version vs. target version per family. */
export async function complianceReport(): Promise<any[]> {
  const { rows } = await query(
    `SELECT d.id, d.hostname, d.family, d.model, d.ios_version,
            fc.target_version,
            (fc.target_version IS NOT NULL AND d.ios_version = fc.target_version) AS compliant
     FROM devices d LEFT JOIN firmware_compliance fc ON fc.family = d.family
     ORDER BY d.hostname`);
  return rows;
}
