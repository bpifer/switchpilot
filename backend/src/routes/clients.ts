import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { siteFilter } from './util.js';

/** Normalise any common MAC format to Cisco dotted-hex (aabb.ccdd.eeff). */
function normalizeMac(s: string): string | null {
  const hex = s.toLowerCase().replace(/[.:\-]/g, '');
  if (!/^[0-9a-f]{12}$/.test(hex)) return null;
  return `${hex.slice(0, 4)}.${hex.slice(4, 8)}.${hex.slice(8, 12)}`;
}

export default async function clientRoutes(app: FastifyInstance) {
  // Unified endpoint search. `q` matches endpoints by MAC/IP/vendor/PTR
  // hostname, and (when searching) also surfaces the infrastructure the
  // endpoint table can't hold: managed switches (by hostname or mgmt IP) and
  // unmanaged CDP/LLDP neighbors. Without `q` it lists recent endpoints.
  app.get<{ Querystring: { q?: string; limit?: string; active?: string; siteId?: string } }>(
    '/api/clients',
    { schema: { tags: ['clients'] } },
    async (req, reply) => {
      try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'Authentication required' }); }
      const { q, limit = '100', active, siteId } = req.query;
      const lim = Math.min(parseInt(limit, 10) || 100, 500);
      const term = q?.trim();
      const like = term ? `%${term.replace(/[%_]/g, '\\$&')}%` : '';

      // ---- endpoints ----
      const params: unknown[] = [lim];
      const conds: string[] = [];
      if (active === 'true') conds.push(`ct.last_seen > now() - interval '24 hours'`);
      if (term) {
        params.push(like);
        const li = params.length;
        // Colon/hyphen MACs won't match the stored dotted form via ILIKE, so
        // match the normalised form exactly too.
        const mac = normalizeMac(term);
        let macClause = '';
        if (mac) { params.push(mac); macClause = ` OR ct.mac = $${params.length}`; }
        conds.push(`(ct.mac ILIKE $${li} OR ct.ip_address::text ILIKE $${li}` +
                   ` OR ct.vendor ILIKE $${li} OR ct.ptr_hostname ILIKE $${li}${macClause})`);
      }
      const sf = siteFilter(siteId, 'd', params.length + 1);
      if (sf.cond) { conds.push(sf.cond); params.push(...sf.params); }
      const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

      const { rows: endpoints } = await query(
        `SELECT ct.id, ct.mac, ct.ip_address, ct.port_name, ct.vlan,
                ct.vendor, ct.ptr_hostname, ct.first_seen, ct.last_seen,
                d.id AS device_id, d.hostname, d.mgmt_ip,
                p.description AS port_description
         FROM client_tracking ct
         JOIN devices d ON d.id = ct.device_id
         LEFT JOIN ports p ON p.device_id = ct.device_id AND p.name = ct.port_name
         ${where}
         ORDER BY ct.last_seen DESC
         LIMIT $1`,
        params
      );

      // ---- infrastructure matches (only when searching) ----
      let switches: Record<string, unknown>[] = [];
      let neighbors: Record<string, unknown>[] = [];
      if (term) {
        const sw: unknown[] = [like];
        const swSf = siteFilter(siteId, 'd', sw.length + 1);
        sw.push(...swSf.params);
        ({ rows: switches } = await query(
          `SELECT d.id AS device_id, d.hostname, d.mgmt_ip::text AS mgmt_ip,
                  d.model, d.status, COALESCE(s.name, 'Unassigned') AS site_name
           FROM devices d LEFT JOIN sites s ON s.id = d.site_id
           WHERE (d.hostname ILIKE $1 OR host(d.mgmt_ip) ILIKE $1)
                 ${swSf.cond ? 'AND ' + swSf.cond : ''}
           ORDER BY d.hostname LIMIT 10`, sw));

        const nb: unknown[] = [like];
        const nbSf = siteFilter(siteId, 'd', nb.length + 1);
        nb.push(...nbSf.params);
        ({ rows: neighbors } = await query(
          `SELECT DISTINCT ON (tl.neighbor_name)
                  tl.neighbor_name, tl.neighbor_ip, tl.neighbor_platform,
                  tl.neighbor_port, tl.local_port,
                  d.id AS device_id, d.hostname AS switch_hostname,
                  d.mgmt_ip::text AS switch_ip, COALESCE(s.name, 'Unassigned') AS site_name
           FROM topology_links tl
           JOIN devices d ON d.id = tl.device_id
           LEFT JOIN sites s ON s.id = d.site_id
           WHERE tl.neighbor_name <> ''
                 AND (tl.neighbor_name ILIKE $1 OR tl.neighbor_ip ILIKE $1)
                 ${nbSf.cond ? 'AND ' + nbSf.cond : ''}
           ORDER BY tl.neighbor_name LIMIT 10`, nb));
      }

      return { endpoints, switches, neighbors };
    }
  );

  // Clients seen on a specific device, optionally filtered by port
  app.get<{ Params: { id: string }; Querystring: { port?: string; active?: string } }>(
    '/api/devices/:id/clients',
    { schema: { tags: ['clients'] } },
    async (req, reply) => {
      try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'Authentication required' }); }
      const { id } = req.params;
      const { port, active } = req.query;
      const activeFilter = active === 'true'
        ? `AND last_seen > now() - interval '24 hours'` : '';
      const portFilter = port ? `AND port_name = $2` : '';
      const params: unknown[] = [id];
      if (port) params.push(port);

      const { rows } = await query(
        `SELECT ct.id, ct.mac, ct.ip_address, ct.port_name, ct.vlan, ct.first_seen, ct.last_seen,
                p.description AS port_description
         FROM client_tracking ct
         LEFT JOIN ports p ON p.device_id = ct.device_id AND p.name = ct.port_name
         WHERE ct.device_id = $1 ${activeFilter} ${portFilter}
         ORDER BY ct.last_seen DESC`,
        params
      );
      return rows;
    }
  );

  // History: all devices/ports a specific MAC has been seen on
  app.get<{ Params: { mac: string } }>(
    '/api/clients/:mac/history',
    { schema: { tags: ['clients'] } },
    async (req, reply) => {
      try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'Authentication required' }); }
      const { rows } = await query(
        `SELECT ct.id, ct.mac, ct.port_name, ct.vlan, ct.first_seen, ct.last_seen,
                d.id AS device_id, d.hostname, d.mgmt_ip
         FROM client_tracking ct
         JOIN devices d ON d.id = ct.device_id
         WHERE ct.mac = $1
         ORDER BY ct.last_seen DESC`,
        [req.params.mac.toLowerCase()]
      );
      return rows;
    }
  );
}
