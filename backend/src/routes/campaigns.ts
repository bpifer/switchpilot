import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { audit } from '../audit.js';
import { requireRole } from '../auth/rbac.js';
import { createJob } from '../services/jobService.js';
import { siteFilter } from './util.js';

export default async function campaignRoutes(app: FastifyInstance) {
  // List all campaigns
  app.get('/api/campaigns', { preHandler: requireRole('readonly') }, async () => {
    const { rows } = await query(`
      SELECT c.*,
        fi.filename AS image_filename, fi.version AS image_version, fi.family AS image_family,
        (SELECT count(*)::int FROM firmware_campaign_results WHERE campaign_id=c.id AND status='succeeded') AS succeeded,
        (SELECT count(*)::int FROM firmware_campaign_results WHERE campaign_id=c.id AND status='failed')    AS failed,
        (SELECT count(*)::int FROM firmware_campaign_results WHERE campaign_id=c.id)                        AS total
      FROM firmware_campaigns c
      LEFT JOIN firmware_images fi ON fi.id = c.image_id
      ORDER BY c.created_at DESC
    `);
    return rows;
  });

  // Create a campaign
  app.post('/api/campaigns', {
    preHandler: requireRole('netadmin'),
    schema: {
      body: {
        type: 'object', required: ['name', 'imageId'],
        properties: {
          name:     { type: 'string', minLength: 1 },
          imageId:  { type: 'string', format: 'uuid' },
          rings:    { type: 'array', items: { type: 'string' }, default: ['pilot', 'production'] },
          waitDays: { type: 'integer', minimum: 0, default: 7 }
        }
      }
    }
  }, async (req, reply) => {
    const me = req.user as any;
    const { name, imageId, rings = ['pilot', 'production'], waitDays = 7 } = req.body as any;
    const { rows } = await query(
      `INSERT INTO firmware_campaigns (name, image_id, rings, wait_days, current_ring, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, imageId, rings, waitDays, rings[0] ?? 'pilot', me.username]);
    await audit(me.username, 'campaign.create', rows[0].id, { name, rings, waitDays }, req.ip);
    return reply.code(201).send(rows[0]);
  });

  // Get one campaign with per-ring results
  app.get('/api/campaigns/:id', { preHandler: requireRole('readonly') }, async (req, reply) => {
    const { id } = req.params as any;
    const { rows: [c] } = await query(
      `SELECT c.*, fi.filename AS image_filename, fi.version AS image_version, fi.family AS image_family
       FROM firmware_campaigns c
       LEFT JOIN firmware_images fi ON fi.id = c.image_id
       WHERE c.id = $1`, [id]);
    if (!c) return reply.code(404).send({ error: 'Campaign not found' });

    const { rows: results } = await query(
      `SELECT r.*, d.hostname, host(d.mgmt_ip) AS mgmt_ip, d.ios_version
       FROM firmware_campaign_results r
       LEFT JOIN devices d ON d.id = r.device_id
       WHERE r.campaign_id = $1
       ORDER BY r.ring, d.hostname`, [id]);

    // Count devices per ring (from devices table with ring column)
    const { rows: ringCounts } = await query(
      `SELECT ring, count(*)::int AS device_count FROM devices GROUP BY ring`);

    return { ...c, results, ring_counts: Object.fromEntries(ringCounts.map(r => [r.ring, r.device_count])) };
  });

  // Start a campaign — creates upgrade jobs for the first ring
  app.post('/api/campaigns/:id/start', { preHandler: requireRole('netadmin') }, async (req, reply) => {
    const { id } = req.params as any;
    const me = req.user as any;

    const { rows: [c] } = await query('SELECT * FROM firmware_campaigns WHERE id=$1', [id]);
    if (!c) return reply.code(404).send({ error: 'Campaign not found' });
    if (c.status !== 'draft') return reply.code(409).send({ error: `Campaign is already ${c.status}` });

    const firstRing = c.rings[0];
    const { rows: devices } = await query(
      `SELECT id FROM devices WHERE ring = $1 AND status != 'unknown'`, [firstRing]);

    if (!devices.length) return reply.code(422).send({ error: `No devices in ring '${firstRing}'` });

    await query(
      `UPDATE firmware_campaigns SET status='running', current_ring=$1, ring_started_at=now() WHERE id=$2`,
      [firstRing, id]);

    // Seed result rows for this ring
    for (const d of devices) {
      await query(
        `INSERT INTO firmware_campaign_results (campaign_id, ring, device_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [id, firstRing, d.id]);
    }

    // Queue upgrade job
    await createJob({
      type: 'firmware_upgrade',
      name: `Campaign: ${c.name} — ${firstRing} ring`,
      payload: { imageId: c.image_id, campaignId: id, ring: firstRing },
      deviceIds: devices.map((d: any) => d.id),
      scheduleAt: null,
      createdBy: me.username
    });

    await audit(me.username, 'campaign.start', id, { ring: firstRing }, req.ip);
    return { ok: true, ring: firstRing, device_count: devices.length };
  });

  // Advance to the next ring (manual or after wait period)
  app.post('/api/campaigns/:id/advance', { preHandler: requireRole('netadmin') }, async (req, reply) => {
    const { id } = req.params as any;
    const me = req.user as any;

    const { rows: [c] } = await query('SELECT * FROM firmware_campaigns WHERE id=$1', [id]);
    if (!c) return reply.code(404).send({ error: 'Campaign not found' });
    if (c.status !== 'running' && c.status !== 'paused') {
      return reply.code(409).send({ error: `Cannot advance a ${c.status} campaign` });
    }

    const currentIdx = (c.rings as string[]).indexOf(c.current_ring);
    const nextRing = (c.rings as string[])[currentIdx + 1];
    if (!nextRing) {
      // All rings complete
      await query(`UPDATE firmware_campaigns SET status='completed' WHERE id=$1`, [id]);
      return { ok: true, completed: true };
    }

    const { rows: devices } = await query(
      `SELECT id FROM devices WHERE ring = $1 AND status != 'unknown'`, [nextRing]);

    await query(
      `UPDATE firmware_campaigns SET current_ring=$1, ring_started_at=now(), status='running' WHERE id=$2`,
      [nextRing, id]);

    for (const d of devices) {
      await query(
        `INSERT INTO firmware_campaign_results (campaign_id, ring, device_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [id, nextRing, d.id]);
    }

    if (devices.length) {
      await createJob({
        type: 'firmware_upgrade',
        name: `Campaign: ${c.name} — ${nextRing} ring`,
        payload: { imageId: c.image_id, campaignId: id, ring: nextRing },
        deviceIds: devices.map((d: any) => d.id),
        scheduleAt: null,
        createdBy: me.username
      });
    }

    await audit(me.username, 'campaign.advance', id, { from: c.current_ring, to: nextRing }, req.ip);
    return { ok: true, ring: nextRing, device_count: devices.length };
  });

  // Pause / abort
  app.post('/api/campaigns/:id/pause', { preHandler: requireRole('netadmin') }, async (req, reply) => {
    const { id } = req.params as any;
    await query(`UPDATE firmware_campaigns SET status='paused' WHERE id=$1 AND status='running'`, [id]);
    return { ok: true };
  });

  app.post('/api/campaigns/:id/abort', { preHandler: requireRole('netadmin') }, async (req, reply) => {
    const { id } = req.params as any;
    const me = req.user as any;
    await query(`UPDATE firmware_campaigns SET status='aborted' WHERE id=$1`, [id]);
    await audit(me.username, 'campaign.abort', id, {}, req.ip);
    return { ok: true };
  });

  // Set a device's deployment ring
  app.patch('/api/devices/:id/ring', {
    preHandler: requireRole('netadmin'),
    schema: {
      body: {
        type: 'object', required: ['ring'],
        properties: { ring: { type: 'string', enum: ['pilot', 'production', 'critical'] } }
      }
    }
  }, async (req, reply) => {
    const { id } = req.params as any;
    const { ring } = req.body as any;
    const me = req.user as any;
    const { rowCount } = await query('UPDATE devices SET ring=$1 WHERE id=$2', [ring, id]);
    if (!rowCount) return reply.code(404).send({ error: 'Device not found' });
    await audit(me.username, 'device.ring.set', id, { ring }, req.ip);
    return { ok: true };
  });

  // Lifecycle summary for all devices
  app.get('/api/devices/lifecycle', {
    preHandler: requireRole('readonly'),
    schema: { querystring: { type: 'object', properties: { siteId: { type: 'string' } } } }
  }, async (req) => {
    const sf = siteFilter((req.query as any).siteId, 'd');
    const { rows } = await query(`
      SELECT d.id, d.hostname, host(d.mgmt_ip) AS mgmt_ip, d.model, d.ios_version,
             d.eos_date::text, d.eol_date::text, d.recommended_release, d.status,
             COALESCE(s.name, 'Unassigned') AS site_name
      FROM devices d
      LEFT JOIN sites s ON s.id = d.site_id
      WHERE (d.eos_date IS NOT NULL OR d.eol_date IS NOT NULL OR d.recommended_release != '')
        ${sf.cond ? 'AND ' + sf.cond : ''}
      ORDER BY d.eol_date ASC NULLS LAST, d.eos_date ASC NULLS LAST, d.hostname
    `, sf.params);
    return rows;
  });
}
