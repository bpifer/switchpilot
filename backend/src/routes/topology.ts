import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { requireRole } from '../auth/rbac.js';
import { siteFilter } from './util.js';

/** "1000" | "a-1000" | "10G" | "10Gbps" -> Mbps, for link-utilization math. */
function speedToMbps(s: string | null | undefined): number | null {
  if (!s) return null;
  const g = s.match(/([\d.]+)\s*g/i);
  if (g) return Math.round(parseFloat(g[1]) * 1000);
  const m = s.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

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
      // Enrich edges with the local port's VLAN, link speed, and live
      // utilization (latest port_metrics bandwidth vs the port's speed). Powers
      // the link-utilization + VLAN overlays. Bandwidth may be null on vendors
      // that don't expose per-port bps, in which case utilization stays null.
      const deviceIds = devices.map(d => d.id);
      if (deviceIds.length && edges.length) {
        const [metrics, portRows] = await Promise.all([
          query<{ device_id: string; port_name: string; in_bps: string | null; out_bps: string | null }>(
            `SELECT DISTINCT ON (device_id, port_name) device_id, port_name, in_bps, out_bps
             FROM port_metrics WHERE device_id = ANY($1)
             ORDER BY device_id, port_name, recorded_at DESC`, [deviceIds]),
          query<{ device_id: string; name: string; speed: string | null; vlan: string | null }>(
            `SELECT device_id, name, speed, vlan FROM ports WHERE device_id = ANY($1)`, [deviceIds]),
        ]);
        const mByPort = new Map(metrics.rows.map(r => [`${r.device_id}|${r.port_name}`, r]));
        const pByPort = new Map(portRows.rows.map(r => [`${r.device_id}|${r.name}`, r]));
        for (const e of edges) {
          const k = `${e.source}|${e.sourcePort}`;
          const m = mByPort.get(k);
          const p = pByPort.get(k);
          if (p) { e.vlan = p.vlan ?? null; e.speedMbps = speedToMbps(p.speed); }
          if (m) {
            e.inBps = m.in_bps != null ? Number(m.in_bps) : null;
            e.outBps = m.out_bps != null ? Number(m.out_bps) : null;
          }
          const speedBps = (e.speedMbps ?? 0) * 1e6;
          const peak = Math.max(e.inBps ?? 0, e.outBps ?? 0);
          e.utilizationPct = speedBps > 0 && peak > 0 ? Math.min(100, Math.round((peak / speedBps) * 100)) : null;
        }
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
