import { query } from '../db.js';
import { CiscoSshSession } from '../cisco/sshClient.js';
import { getDevice, sshTargetFor } from './deviceComms.js';
import { commandsForFamily } from '../cisco/capabilities.js';

/**
 * Upgrade a device to a registered firmware image.
 *
 * The image must already be retrievable by the switch (the platform exposes
 * uploaded images over HTTP at /api/firmware/files/<filename> — switches copy
 * via `copy http://<platform>/... flash:`). Flow:
 *   1. copy image to flash, 2. verify MD5, 3. set boot (or install add on IOS-XE),
 *   4. reload. Rollback = boot statement still lists the previous image.
 */
export async function upgradeFirmware(deviceId: string, imageId: string): Promise<string> {
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

  const session = new CiscoSshSession({ ...(await sshTargetFor(device)), timeoutMs: 30000 });
  await session.connect();
  const log: string[] = [];
  try {
    await session.enable();

    log.push(await session.exec(`copy ${url} flash:${image.filename}`, 1800_000));

    const verify = await session.exec(`verify /md5 flash:${image.filename} ${image.md5}`, 600_000);
    log.push(verify);
    if (!/Verified/i.test(verify)) throw new Error(`MD5 verification failed:\n${verify}`);

    const caps = device.capabilities as any;
    if (caps?.installMode) {
      const cmd = (commandsForFamily(device.family).installAdd ?? 'install add file flash:{file} activate commit')
        .replace('{file}', image.filename);
      log.push(await session.exec(cmd, 2400_000)); // install mode reloads as part of activate
    } else {
      await session.configure([`boot system flash:${image.filename}`]);
      await session.saveConfig();
      log.push('boot statement updated; issuing reload');
      // reload prompts for confirmation
      log.push(await session.exec('reload', 10_000).catch(() => ''));
      log.push(await session.exec('', 5_000).catch(() => '')); // confirm prompt
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
