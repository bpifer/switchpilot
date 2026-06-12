import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { audit } from '../audit.js';
import { requireRole } from '../auth/rbac.js';
import { devicePushConfig, deviceExec, bouncePort, cableTest } from '../services/deviceComms.js';
import { expandInterfaceName, parseMacTable, parseVlanBrief } from '../cisco/parsers.js';

export default async function portRoutes(app: FastifyInstance) {
  app.get('/api/devices/:id/ports', { preHandler: requireRole('readonly'), schema: { tags: ['ports'] } },
    async (req) => {
      const { rows } = await query(
        `SELECT * FROM ports WHERE device_id=$1
         ORDER BY regexp_replace(name, '\\d.*$', ''),
                  string_to_array(regexp_replace(name, '^\\D+', ''), '/')::int[]`,
        [(req.params as any).id]);
      return rows;
    });

  // Historical samples for one port (collected on each metrics sweep)
  app.get('/api/devices/:id/ports/:port/metrics', {
    preHandler: requireRole('readonly'),
    schema: {
      tags: ['ports'],
      querystring: {
        type: 'object',
        properties: { hours: { type: 'integer', minimum: 1, maximum: 168, default: 24 } }
      }
    }
  }, async (req) => {
    const { id, port } = req.params as any;
    const hours = (req.query as any).hours ?? 24;
    const { rows } = await query(
      `SELECT recorded_at, in_bps, out_bps, in_errors, out_errors, status
       FROM port_metrics
       WHERE device_id=$1 AND port_name=$2 AND recorded_at > now() - ($3 * interval '1 hour')
       ORDER BY recorded_at`,
      [id, port, hours]);
    return rows;
  });

  // Live MAC table for one port
  app.get('/api/devices/:id/ports/:port/macs', { preHandler: requireRole('readonly'), schema: { tags: ['ports'] } },
    async (req) => {
      const { id, port } = req.params as any;
      const out = await deviceExec(id, [`show mac address-table interface ${expandInterfaceName(port)}`]);
      return parseMacTable(Object.values(out)[0] ?? '');
    });

  // Enable / disable a port
  app.post('/api/devices/:id/ports/:port/admin', {
    preHandler: requireRole('helpdesk'),
    schema: {
      tags: ['ports'],
      body: { type: 'object', required: ['enabled'], properties: { enabled: { type: 'boolean' } } }
    }
  }, async (req) => {
    const { id, port } = req.params as any;
    const { enabled } = req.body as any;
    const me = req.user as any;
    const iface = expandInterfaceName(port);
    await devicePushConfig(id, [`interface ${iface}`, enabled ? 'no shutdown' : 'shutdown']);
    await query('UPDATE ports SET admin_up=$1 WHERE device_id=$2 AND name=$3', [enabled, id, port]);
    await audit(me.username, enabled ? 'port.enable' : 'port.disable', `${id}/${port}`, {}, req.ip);
    return { ok: true };
  });

  // Change access VLAN / description / mode
  app.post('/api/devices/:id/ports/:port/config', {
    preHandler: requireRole('helpdesk'),
    schema: {
      tags: ['ports'],
      body: {
        type: 'object',
        properties: {
          vlan: { type: 'integer', minimum: 1, maximum: 4094 },
          voiceVlan: { type: 'integer', minimum: 1, maximum: 4094 },
          description: { type: 'string', maxLength: 200 },
          mode: { type: 'string', enum: ['access', 'trunk'] },
          trunkNativeVlan: { type: 'integer', minimum: 1, maximum: 4094 },
          trunkAllowedVlans: { type: 'string', pattern: '^[0-9,\\-]*$' },
          speed: { type: 'string', enum: ['auto', '10', '100', '1000', '10000'] },
          duplex: { type: 'string', enum: ['auto', 'full', 'half'] },
          portfast: { type: 'boolean' },
          bpduGuard: { type: 'boolean' },
          poeEnabled: { type: 'boolean' }
        }
      }
    }
  }, async (req) => {
    const { id, port } = req.params as any;
    const b = req.body as any;
    const me = req.user as any;
    const iface = expandInterfaceName(port);
    const lines = [`interface ${iface}`];
    if (b.description !== undefined) lines.push(b.description ? `description ${b.description}` : 'no description');
    if (b.mode === 'access') {
      lines.push('switchport mode access');
      if (b.vlan) lines.push(`switchport access vlan ${b.vlan}`);
    } else if (b.mode === 'trunk') {
      lines.push('switchport mode trunk');
      if (b.trunkNativeVlan) lines.push(`switchport trunk native vlan ${b.trunkNativeVlan}`);
      if (b.trunkAllowedVlans) lines.push(`switchport trunk allowed vlan ${b.trunkAllowedVlans}`);
    } else if (b.vlan) {
      lines.push(`switchport access vlan ${b.vlan}`);
    }
    if (b.voiceVlan !== undefined) lines.push(`switchport voice vlan ${b.voiceVlan}`);
    if (b.speed) lines.push(`speed ${b.speed}`);
    if (b.duplex) lines.push(`duplex ${b.duplex}`);
    if (b.portfast !== undefined) lines.push(b.portfast ? 'spanning-tree portfast' : 'no spanning-tree portfast');
    if (b.bpduGuard !== undefined) lines.push(b.bpduGuard ? 'spanning-tree bpduguard enable' : 'spanning-tree bpduguard disable');
    if (b.poeEnabled !== undefined) lines.push(b.poeEnabled ? 'power inline auto' : 'power inline never');
    const output = await devicePushConfig(id, lines);
    // Mirror the change into the ports table so the UI is correct immediately
    // (the next full refresh re-syncs from the device anyway)
    const sets: string[] = [];
    const params: unknown[] = [];
    if (b.description !== undefined) { params.push(b.description); sets.push(`description=$${params.length}`); }
    if (b.mode === 'trunk') { params.push('trunk'); sets.push(`vlan=$${params.length}`, `mode='trunk'`); }
    else if (b.vlan) { params.push(String(b.vlan)); sets.push(`vlan=$${params.length}`, `mode='access'`); }
    if (sets.length) {
      params.push(id, port);
      await query(`UPDATE ports SET ${sets.join(', ')}, updated_at=now()
                   WHERE device_id=$${params.length - 1} AND name=$${params.length}`, params);
    }
    await audit(me.username, 'port.config', `${id}/${port}`, b, req.ip);
    return { ok: true, output };
  });

  // Bounce (shutdown / no shutdown)
  app.post('/api/devices/:id/ports/:port/bounce', { preHandler: requireRole('helpdesk'), schema: { tags: ['ports'] } },
    async (req) => {
      const { id, port } = req.params as any;
      const me = req.user as any;
      await bouncePort(id, port);
      await audit(me.username, 'port.bounce', `${id}/${port}`, {}, req.ip);
      return { ok: true };
    });

  // TDR cable test
  app.post('/api/devices/:id/ports/:port/cable-test', { preHandler: requireRole('helpdesk'), schema: { tags: ['ports'] } },
    async (req) => {
      const { id, port } = req.params as any;
      const me = req.user as any;
      const result = await cableTest(id, port);
      await audit(me.username, 'port.cabletest', `${id}/${port}`, {}, req.ip);
      return { result };
    });

  // ----- VLANs -----
  app.get('/api/devices/:id/vlans', { preHandler: requireRole('readonly'), schema: { tags: ['vlans'] } },
    async (req) => {
      const out = await deviceExec((req.params as any).id, ['show vlan brief']);
      return parseVlanBrief(Object.values(out)[0] ?? '');
    });

  app.post('/api/devices/:id/vlans', {
    preHandler: requireRole('netadmin'),
    schema: {
      tags: ['vlans'],
      body: {
        type: 'object', required: ['vlanId', 'name'],
        properties: { vlanId: { type: 'integer', minimum: 1, maximum: 4094 }, name: { type: 'string', pattern: '^[\\w-]+$' } }
      }
    }
  }, async (req) => {
    const { id } = req.params as any;
    const { vlanId, name } = req.body as any;
    const me = req.user as any;
    await devicePushConfig(id, [`vlan ${vlanId}`, `name ${name}`]);
    await audit(me.username, 'vlan.create', `${id}/vlan${vlanId}`, { name }, req.ip);
    return { ok: true };
  });

  app.delete('/api/devices/:id/vlans/:vlanId', { preHandler: requireRole('netadmin'), schema: { tags: ['vlans'] } },
    async (req) => {
      const { id, vlanId } = req.params as any;
      const me = req.user as any;
      await devicePushConfig(id, [`no vlan ${parseInt(vlanId, 10)}`]);
      await audit(me.username, 'vlan.delete', `${id}/vlan${vlanId}`, {}, req.ip);
      return { ok: true };
    });
}
