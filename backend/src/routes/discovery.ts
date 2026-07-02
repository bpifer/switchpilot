import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { audit } from '../audit.js';
import { requireRole } from '../auth/rbac.js';
import { siteFilter, isIpAddress } from './util.js';

export default async function discoveryRoutes(app: FastifyInstance) {
  /**
   * Suggest new devices from CDP/LLDP neighbor data already collected from managed devices.
   * Returns neighbors whose IPs are not yet in the devices table. Scoped to the
   * observing device's site when a site is selected.
   */
  app.get('/api/discovery/suggest', {
    preHandler: requireRole('netadmin'),
    schema: { tags: ['discovery'], querystring: { type: 'object', properties: { siteId: { type: 'string' } } } }
  }, async (req) => {
    const sf = siteFilter((req.query as any).siteId, 'd');
    const { rows } = await query(
      `SELECT DISTINCT
         tl.neighbor_name, tl.neighbor_ip, tl.neighbor_platform, tl.protocol,
         d.hostname AS seen_by_hostname, d.mgmt_ip AS seen_by_ip
       FROM topology_links tl
       JOIN devices d ON d.id = tl.device_id
       WHERE tl.neighbor_ip != ''
         ${sf.cond ? 'AND ' + sf.cond : ''}
         AND NOT EXISTS (
           SELECT 1 FROM devices x WHERE host(x.mgmt_ip) = tl.neighbor_ip
         )
       ORDER BY tl.neighbor_ip`, sf.params);
    return rows;
  });

  /**
   * Bulk import devices from CSV.
   * Expected columns: hostname, mgmt_ip, model, credential_id, site_id
   * credential_id and site_id are optional UUIDs.
   */
  app.post('/api/devices/import', {
    preHandler: requireRole('netadmin'),
    schema: {
      tags: ['discovery'],
      body: {
        type: 'object', required: ['csv'],
        properties: { csv: { type: 'string' } }
      }
    }
  }, async (req, reply) => {
    const me = req.user as any;
    const { csv } = req.body as { csv: string };
    const lines = csv.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return reply.code(400).send({ error: 'CSV must have a header row and at least one data row' });

    const header = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const results: any[] = [];

    for (const line of lines.slice(1)) {
      const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
      const row: Record<string, string> = {};
      header.forEach((h, i) => { row[h] = cols[i] ?? ''; });

      const ip = row['mgmt_ip'] || row['ip'] || row['management_ip'];
      if (!ip) { results.push({ row: line, ok: false, error: 'mgmt_ip column missing or empty' }); continue; }
      // Validate before the ::inet cast so a bad cell gives a clean row-level
      // message instead of a raw Postgres cast error.
      if (!isIpAddress(ip)) { results.push({ ip, ok: false, error: `not a valid IP address: "${ip}"` }); continue; }

      try {
        const { rows } = await query(
          `INSERT INTO devices (hostname, mgmt_ip, model, credential_id, site_id)
           VALUES ($1, $2::inet, $3, $4::uuid, $5::uuid)
           ON CONFLICT (mgmt_ip) DO NOTHING
           RETURNING id`,
          [row['hostname'] || '', ip,
           row['model'] || '',
           row['credential_id'] || null,
           row['site_id'] || null]);
        // ON CONFLICT DO NOTHING returns no row when the IP already exists.
        if (!rows[0]) { results.push({ ip, ok: false, error: 'a device with this management IP already exists' }); continue; }
        results.push({ ip, id: rows[0].id, ok: true });
      } catch (err) {
        results.push({ ip, ok: false, error: (err as Error).message });
      }
    }

    const imported = results.filter(r => r.ok).length;
    await audit(me.username, 'devices.import', 'csv', { imported, total: results.length }, req.ip);
    return { imported, total: results.length, results };
  });
}
