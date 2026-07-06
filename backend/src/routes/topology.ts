import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { audit } from '../audit.js';
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

      // Operator-drawn manual links (connections CDP/LLDP can't see). They ride
      // the same edge shape with manual:true + their row id so the UI can render
      // them dashed and offer delete. External targets reuse the ext:<label>
      // node convention so a manual link to a discovered neighbor merges with it.
      const mf = siteFilter(siteId, 'd');
      const manual = (await query(
        `SELECT m.* FROM manual_topology_links m
         JOIN devices d ON d.id = m.from_device_id ${mf.cond ? 'WHERE ' + mf.cond : ''}`, mf.params)).rows;
      for (const m of manual) {
        let targetId: string;
        if (m.to_device_id) {
          targetId = m.to_device_id;
        } else {
          targetId = `ext:${m.to_label.toLowerCase()}`;
          if (!externals.has(targetId)) {
            externals.set(targetId, {
              id: targetId, label: m.to_label, model: '',
              status: 'unknown', managed: false, ip: null, stackSize: 0
            });
          }
        }
        edges.push({
          source: m.from_device_id, target: targetId,
          sourcePort: m.from_port, targetPort: m.to_port,
          protocol: 'manual', manual: true, manualId: m.id, note: m.note
        });
      }

      // Flag managed devices with no discovered neighbor links (orphans): a
      // possible monitoring gap, a standalone device, or CDP/LLDP not running.
      // Manual links count - an operator saying "this is cabled here" resolves
      // the "is anything connected?" question the orphan flag exists to raise.
      const linked = new Set<string>();
      for (const e of edges) { linked.add(e.source); linked.add(e.target); }
      for (const n of nodes) if (n.managed && !linked.has(n.id)) n.orphan = true;
      return { nodes: [...nodes, ...externals.values()], edges };
    });

  // ----- Manual links CRUD -----
  app.post('/api/topology/manual-links', {
    preHandler: requireRole('netadmin'),
    schema: {
      tags: ['topology'],
      body: {
        type: 'object', required: ['fromDeviceId'],
        properties: {
          fromDeviceId: { type: 'string' },
          fromPort: { type: 'string', maxLength: 100 },
          toDeviceId: { type: 'string', nullable: true },
          toLabel: { type: 'string', maxLength: 200 },
          toPort: { type: 'string', maxLength: 100 },
          note: { type: 'string', maxLength: 500 }
        }
      }
    }
  }, async (req, reply) => {
    const b = req.body as any;
    const me = req.user as any;
    if (!b.toDeviceId && !(b.toLabel ?? '').trim()) {
      return reply.code(400).send({ error: 'Provide a target device or an external label.' });
    }
    if (b.toDeviceId && b.toDeviceId === b.fromDeviceId) {
      return reply.code(400).send({ error: 'A link cannot connect a device to itself.' });
    }
    const { rows } = await query(
      `INSERT INTO manual_topology_links (from_device_id, from_port, to_device_id, to_label, to_port, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [b.fromDeviceId, (b.fromPort ?? '').trim(), b.toDeviceId || null, (b.toLabel ?? '').trim(),
       (b.toPort ?? '').trim(), (b.note ?? '').trim(), me.username]);
    await audit(me.username, 'topology.manual_link.create', rows[0].id, b, req.ip);
    return reply.code(201).send(rows[0]);
  });

  app.delete('/api/topology/manual-links/:id', { preHandler: requireRole('netadmin'), schema: { tags: ['topology'] } },
    async (req) => {
      const me = req.user as any;
      await query('DELETE FROM manual_topology_links WHERE id=$1', [(req.params as any).id]);
      await audit(me.username, 'topology.manual_link.delete', (req.params as any).id, {}, req.ip);
      return { ok: true };
    });

  app.get('/api/devices/:id/neighbors', { preHandler: requireRole('readonly'), schema: { tags: ['topology'] } },
    async (req) => (await query(
      'SELECT * FROM topology_links WHERE device_id=$1 ORDER BY local_port', [(req.params as any).id])).rows);
}
