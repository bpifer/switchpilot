import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, stat, statfs, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { query } from '../db.js';
import { audit } from '../audit.js';
import { config } from '../config.js';
import { requireRole } from '../auth/rbac.js';
import { complianceReport } from '../services/firmwareService.js';
import { createJob } from '../services/jobService.js';
import { listFamilies } from '../cisco/capabilities.js';

export default async function firmwareRoutes(app: FastifyInstance) {
  app.get('/api/firmware', { preHandler: requireRole('readonly'), schema: { tags: ['firmware'] } },
    async () => (await query('SELECT * FROM firmware_images ORDER BY family, version')).rows);

  // Upload an IOS image (multipart). MD5 computed server-side for verification.
  app.post('/api/firmware', { preHandler: requireRole('netadmin'), schema: { tags: ['firmware'], consumes: ['multipart/form-data'] } },
    async (req, reply) => {
      const me = req.user as any;
      const data = await (req as any).file({ limits: { fileSize: 2 * 1024 * 1024 * 1024 } });
      if (!data) return reply.code(400).send({ error: 'No file uploaded' });
      const filename = path.basename(data.filename).replace(/[^\w.\-]/g, '_');
      const family = ((data.fields.family?.value ?? '') as string).trim().toLowerCase();
      const version = ((data.fields.version?.value ?? '') as string).trim();
      if (!family || !version) return reply.code(400).send({ error: 'family and version fields are required' });
      // family must match a known capability family so compliance joins and the
      // image/device family check in upgradeFirmware can't be silently wrong
      const known = Object.keys(listFamilies());
      if (!known.includes(family)) {
        return reply.code(400).send({ error: `Unknown family "${family}". Known families: ${known.join(', ')}` });
      }
      if (!/^[\w.()\-]{1,32}$/.test(version)) {
        return reply.code(400).send({ error: 'version must be 1-32 chars: letters, digits, . ( ) - _' });
      }

      await mkdir(config.firmwareDir, { recursive: true });

      // Don't start streaming a multi-hundred-MB upload onto a full volume -
      // a mid-stream failure leaves a partial file. Content-Length slightly
      // overstates the file (multipart framing), which is a safe direction.
      const expected = parseInt((req.headers['content-length'] as string) ?? '0', 10);
      const vol = await statfs(config.firmwareDir).catch(() => null);
      if (vol && expected && vol.bavail * vol.bsize < expected + 50 * 1024 * 1024) {
        return reply.code(507).send({
          error: `Not enough space on the firmware volume: upload is ~${Math.round(expected / 1024 / 1024)} MB, ` +
                 `${Math.round((vol.bavail * vol.bsize) / 1024 / 1024)} MB free. Delete old images first.`
        });
      }

      const dest = path.join(config.firmwareDir, filename);
      const hash = crypto.createHash('md5');
      data.file.on('data', (c: Buffer) => hash.update(c));
      await pipeline(data.file, createWriteStream(dest));
      const size = (await stat(dest)).size;

      const { rows } = await query(
        `INSERT INTO firmware_images (filename, family, version, md5, size_bytes, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [filename, family, version, hash.digest('hex'), size, me.username]);
      await audit(me.username, 'firmware.upload', filename, { family, version }, req.ip);
      return reply.code(201).send(rows[0]);
    });

  // Delete an image (DB row + file). Refused while an upgrade job references it.
  app.delete('/api/firmware/:imageId', { preHandler: requireRole('netadmin'), schema: { tags: ['firmware'] } },
    async (req, reply) => {
      const { imageId } = req.params as any;
      const me = req.user as any;
      const { rows } = await query('SELECT * FROM firmware_images WHERE id=$1', [imageId]);
      if (!rows[0]) return reply.code(404).send({ error: 'Image not found' });
      const active = await query(
        `SELECT 1 FROM jobs WHERE type='firmware_upgrade' AND status IN ('pending','running')
           AND payload->>'imageId' = $1 LIMIT 1`, [imageId]);
      if (active.rows[0]) return reply.code(409).send({ error: 'An active upgrade job references this image' });
      await query('DELETE FROM firmware_images WHERE id=$1', [imageId]);
      await unlink(path.join(config.firmwareDir, rows[0].filename)).catch(() => { /* already gone */ });
      await audit(me.username, 'firmware.delete', rows[0].filename, {}, req.ip);
      return { ok: true };
    });

  // Serve image files so switches can `copy http://... flash:`.
  // DELIBERATELY UNAUTHENTICATED: IOS cannot attach a JWT to a copy command.
  // The DB filename allowlist prevents path traversal; restrict this path to
  // the switch management network at the firewall/Ingress layer (see README
  // deployment notes). Rate-limited hard because images are hundreds of MB.
  app.get('/api/firmware/files/:filename', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { tags: ['firmware'] }
  },
    async (req, reply) => {
      const filename = path.basename((req.params as any).filename);
      const { rows } = await query('SELECT 1 FROM firmware_images WHERE filename=$1', [filename]);
      if (!rows[0]) return reply.code(404).send({ error: 'Unknown image' });
      return reply.type('application/octet-stream')
        .send(createReadStream(path.join(config.firmwareDir, filename)));
    });

  // Schedule an upgrade job for one or more devices
  app.post('/api/firmware/:imageId/upgrade', {
    preHandler: requireRole('netadmin'),
    schema: {
      tags: ['firmware'],
      body: {
        type: 'object', required: ['deviceIds'],
        properties: {
          deviceIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
          scheduleAt: { type: 'string', format: 'date-time' }
        }
      }
    }
  }, async (req, reply) => {
    const { imageId } = req.params as any;
    const { deviceIds, scheduleAt } = req.body as any;
    const me = req.user as any;
    // Fail fast with a clear message instead of letting every device error in the job
    if (!process.env.PLATFORM_URL) {
      return reply.code(400).send({
        error: 'PLATFORM_URL is not set in the API environment. Switches download images from ' +
               'PLATFORM_URL/api/firmware/files/<name>, so set it to a URL reachable from the ' +
               'switch management network (e.g. http://192.168.10.226:8080) and restart the API.'
      });
    }
    const job = await createJob({
      type: 'firmware_upgrade',
      name: `Firmware upgrade (${deviceIds.length} device${deviceIds.length > 1 ? 's' : ''})`,
      payload: { imageId },
      deviceIds,
      scheduleAt: scheduleAt ? new Date(scheduleAt) : null,
      createdBy: me.username
    });
    await audit(me.username, 'firmware.upgrade', imageId, { deviceIds, scheduleAt }, req.ip);
    return reply.code(202).send(job);
  });

  // Compliance targets + report
  app.put('/api/firmware/compliance/:family', {
    preHandler: requireRole('netadmin'),
    schema: {
      tags: ['firmware'],
      body: { type: 'object', required: ['targetVersion'], properties: { targetVersion: { type: 'string' } } }
    }
  }, async (req) => {
    const me = req.user as any;
    await query(
      `INSERT INTO firmware_compliance (family, target_version, set_by) VALUES ($1,$2,$3)
       ON CONFLICT (family) DO UPDATE SET target_version=$2, set_by=$3, set_at=now()`,
      [(req.params as any).family, (req.body as any).targetVersion, me.username]);
    return { ok: true };
  });

  app.get('/api/firmware/compliance', { preHandler: requireRole('readonly'), schema: { tags: ['firmware'] } },
    async () => complianceReport());
}
