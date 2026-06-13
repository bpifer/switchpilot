import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { siteFilter } from './util.js';

export default async function clientRoutes(app: FastifyInstance) {
  // Search clients by MAC (partial match), or list recent clients globally
  app.get<{ Querystring: { q?: string; limit?: string; active?: string; siteId?: string } }>(
    '/api/clients',
    { schema: { tags: ['clients'] } },
    async (req, reply) => {
      try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'Authentication required' }); }
      const { q, limit = '100', active, siteId } = req.query;
      const lim = Math.min(parseInt(limit, 10) || 100, 500);
      const activeFilter = active === 'true'
        ? `AND ct.last_seen > now() - interval '24 hours'` : '';
      const macFilter = q
        ? `AND ct.mac ILIKE $2` : '';
      const params: unknown[] = [lim];
      if (q) params.push(`%${q.replace(/[%_]/g, '\\$&')}%`);
      const sf = siteFilter(siteId, 'd', params.length + 1);
      params.push(...sf.params);
      const siteCond = sf.cond ? `AND ${sf.cond}` : '';

      const { rows } = await query(
        `SELECT ct.id, ct.mac, ct.ip_address, ct.port_name, ct.vlan,
                ct.vendor, ct.ptr_hostname, ct.first_seen, ct.last_seen,
                d.id AS device_id, d.hostname, d.mgmt_ip,
                p.description AS port_description
         FROM client_tracking ct
         JOIN devices d ON d.id = ct.device_id
         LEFT JOIN ports p ON p.device_id = ct.device_id AND p.name = ct.port_name
         WHERE 1=1 ${activeFilter} ${macFilter} ${siteCond}
         ORDER BY ct.last_seen DESC
         LIMIT $1`,
        params
      );
      return rows;
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
