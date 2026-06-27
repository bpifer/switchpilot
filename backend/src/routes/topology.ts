import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { requireRole } from '../auth/rbac.js';
import { siteFilter } from './util.js';

export default async function topologyRoutes(app: FastifyInstance) {
  /**
   * Layer-2 topology graph built from CDP/LLDP neighbor tables.
   * Nodes are managed devices plus discovered-but-unmanaged neighbors;
   * edges deduplicate the two directions of a link.
   */
  app.get('/api/topology', {
    preHandler: requireRole('readonly'),
    schema: { tags: ['topology'], querystring: { type: 'object', properties: { siteId: { type: 'string' } } } }
  },
    async (req) => {
      const { siteId } = req.query as any;
      const sf = siteFilter(siteId, 'd');
      const devices = (await query(
        `SELECT d.id, d.hostname, d.model, d.family, d.status, d.mgmt_ip, d.stack_members
         FROM devices d ${sf.cond ? 'WHERE ' + sf.cond : ''}`, sf.params)).rows;
      // links only from in-scope devices, so unmanaged neighbors of other sites don't leak in
      const lf = siteFilter(siteId, 'd');
      const links = (await query(
        `SELECT t.*, d.hostname AS local_hostname FROM topology_links t
         JOIN devices d ON d.id=t.device_id ${lf.cond ? 'WHERE ' + lf.cond : ''}`, lf.params)).rows;

      const byHostname = new Map(devices.map(d => [d.hostname.toLowerCase(), d]));
      const nodes: any[] = devices.map(d => ({
        id: d.id, label: d.hostname, model: d.model, status: d.status,
        managed: true, ip: d.mgmt_ip,
        stackSize: Array.isArray(d.stack_members) ? d.stack_members.length : 0
      }));
      const edges: any[] = [];
      const seen = new Set<string>();
      const externals = new Map<string, any>();

      for (const link of links) {
        const neighbor = byHostname.get(link.neighbor_name.toLowerCase());
        let targetId: string;
        if (neighbor) {
          targetId = neighbor.id;
        } else {
          targetId = `ext:${link.neighbor_name.toLowerCase()}`;
          if (!externals.has(targetId)) {
            externals.set(targetId, {
              id: targetId, label: link.neighbor_name, model: link.neighbor_platform,
              status: 'unknown', managed: false, ip: link.neighbor_ip, stackSize: 0
            });
          }
        }
        // dedupe A->B / B->A
        const key = [link.device_id, targetId].sort().join('|') + '|' + [link.local_port, link.neighbor_port].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({
          source: link.device_id, target: targetId,
          sourcePort: link.local_port, targetPort: link.neighbor_port,
          protocol: link.protocol
        });
      }
      // Flag managed devices with no discovered neighbor links (orphans): a
      // possible monitoring gap, a standalone device, or CDP/LLDP not running.
      const linked = new Set<string>();
      for (const e of edges) { linked.add(e.source); linked.add(e.target); }
      for (const n of nodes) if (n.managed && !linked.has(n.id)) n.orphan = true;
      return { nodes: [...nodes, ...externals.values()], edges };
    });

  app.get('/api/devices/:id/neighbors', { preHandler: requireRole('readonly'), schema: { tags: ['topology'] } },
    async (req) => (await query(
      'SELECT * FROM topology_links WHERE device_id=$1 ORDER BY local_port', [(req.params as any).id])).rows);
}
