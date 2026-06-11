import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { requireRole } from '../auth/rbac.js';

export default async function topologyRoutes(app: FastifyInstance) {
  /**
   * Layer-2 topology graph built from CDP/LLDP neighbor tables.
   * Nodes are managed devices plus discovered-but-unmanaged neighbors;
   * edges deduplicate the two directions of a link.
   */
  app.get('/api/topology', { preHandler: requireRole('readonly'), schema: { tags: ['topology'] } },
    async () => {
      const devices = (await query(
        'SELECT id, hostname, model, family, status, mgmt_ip, stack_members FROM devices')).rows;
      const links = (await query(
        `SELECT t.*, d.hostname AS local_hostname FROM topology_links t
         JOIN devices d ON d.id=t.device_id`)).rows;

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
      return { nodes: [...nodes, ...externals.values()], edges };
    });

  app.get('/api/devices/:id/neighbors', { preHandler: requireRole('readonly'), schema: { tags: ['topology'] } },
    async (req) => (await query(
      'SELECT * FROM topology_links WHERE device_id=$1 ORDER BY local_port', [(req.params as any).id])).rows);
}
