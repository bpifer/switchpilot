import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';

/** Normalise any common MAC format to Cisco dotted-hex (aabb.ccdd.eeff). */
function normalizeMac(s: string): string | null {
  const hex = s.toLowerCase().replace(/[.:\-]/g, '');
  if (!/^[0-9a-f]{12}$/.test(hex)) return null;
  return `${hex.slice(0, 4)}.${hex.slice(4, 8)}.${hex.slice(8, 12)}`;
}

const CLIENT_COLS = `
  ct.mac, ct.ip_address::text AS ip_address, ct.port_name, ct.vlan, ct.last_seen,
  d.id AS device_id, d.hostname AS switch_hostname, d.mgmt_ip AS switch_ip,
  s.name AS site_name,
  p.description AS port_description,
  tl.neighbor_name, tl.neighbor_port, tl.neighbor_ip, tl.neighbor_platform
`;

const CLIENT_JOINS = `
  JOIN devices d ON d.id = ct.device_id
  LEFT JOIN sites s ON s.id = d.site_id
  LEFT JOIN ports p ON p.device_id = ct.device_id AND p.name = ct.port_name
  LEFT JOIN topology_links tl ON tl.device_id = ct.device_id AND tl.local_port = ct.port_name
`;

export default async function locateRoutes(app: FastifyInstance) {
  app.get('/api/locate', async (req, reply) => {
    try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'Authentication required' }); }

    const { q } = req.query as { q?: string };
    if (!q?.trim()) return [];

    const term = q.trim();
    const results: Record<string, unknown>[] = [];

    // 1. MAC address — try normalisation first; matches any common format
    const mac = normalizeMac(term);
    if (mac) {
      const { rows } = await query(
        `SELECT ${CLIENT_COLS} FROM client_tracking ct ${CLIENT_JOINS}
         WHERE ct.mac = $1 ORDER BY ct.last_seen DESC LIMIT 10`,
        [mac]);
      results.push(...rows.map(r => ({ ...r, match_type: 'mac' })));
    }

    // 2. IP address — check client_tracking first, then mgmt_ip
    const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(term);
    if (!mac && isIp) {
      const { rows } = await query(
        `SELECT ${CLIENT_COLS} FROM client_tracking ct ${CLIENT_JOINS}
         WHERE ct.ip_address = $1::inet ORDER BY ct.last_seen DESC LIMIT 10`,
        [term]);
      results.push(...rows.map(r => ({ ...r, match_type: 'ip' })));

      if (!results.length) {
        // It might be the management IP of a managed switch itself
        const { rows: dRows } = await query(
          `SELECT d.id AS device_id, d.hostname AS switch_hostname, d.mgmt_ip AS switch_ip,
                  d.model, d.status, s.name AS site_name
           FROM devices d LEFT JOIN sites s ON s.id = d.site_id
           WHERE d.mgmt_ip::text = $1`,
          [term]);
        results.push(...dRows.map(r => ({ ...r, match_type: 'device_ip' })));
      }
    }

    // 3. Hostname / partial name — check managed devices then CDP/LLDP neighbors
    if (!mac && !isIp) {
      const like = `%${term}%`;

      const { rows: dRows } = await query(
        `SELECT d.id AS device_id, d.hostname AS switch_hostname, d.mgmt_ip AS switch_ip,
                d.model, d.status, s.name AS site_name
         FROM devices d LEFT JOIN sites s ON s.id = d.site_id
         WHERE d.hostname ILIKE $1 LIMIT 10`,
        [like]);
      results.push(...dRows.map(r => ({ ...r, match_type: 'hostname' })));

      const { rows: nbRows } = await query(
        `SELECT DISTINCT ON (tl.neighbor_name)
                tl.neighbor_name, tl.neighbor_ip, tl.neighbor_platform,
                tl.local_port AS port_name, tl.neighbor_port,
                d.id AS device_id, d.hostname AS switch_hostname, d.mgmt_ip AS switch_ip,
                s.name AS site_name
         FROM topology_links tl
         JOIN devices d ON d.id = tl.device_id
         LEFT JOIN sites s ON s.id = d.site_id
         WHERE tl.neighbor_name ILIKE $1
         ORDER BY tl.neighbor_name LIMIT 10`,
        [like]);
      results.push(...nbRows.map(r => ({ ...r, match_type: 'neighbor' })));
    }

    return results;
  });
}
