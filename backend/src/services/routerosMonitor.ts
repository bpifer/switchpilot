// RouterOS device refresh: the MikroTik equivalent of monitorService's Cisco
// sweep. Reads identity/health/ports/MAC-table/neighbors over the pooled
// RouterOS session and writes the same tables (devices, device_metrics, ports,
// client_tracking, topology_links) so the rest of the app is vendor-agnostic.
// vendor: mikrotik.
import { query } from '../db.js';
import { redis } from '../redis.js';
import { withDeviceSession } from '../cisco/sshPool.js';
import { lookupVendor } from '../cisco/oui.js';
import {
  parseResource, parseCpuLoad, parseHealth, parseInterfaces, parseBridgeHosts,
  parseNeighbors, parseEthernetMonitor, parseTerse,
} from '../routeros/parsers.js';
import { detectRouterOs } from '../routeros/detector.js';
import { resolveRosCapabilities } from '../routeros/capabilities.js';
import { getDevice, sshTargetFor, type DeviceRow } from './deviceComms.js';
import { raiseAlert, resolveAlert } from './alertService.js';

/** Full RouterOS refresh. Mirrors refreshDevice for MikroTik gear. */
export async function refreshRouterOsDevice(deviceId: string): Promise<void> {
  const device = await getDevice(deviceId);
  const target = await sshTargetFor(device);
  await withDeviceSession(target, async session => {
    // --- identity + health ---
    const resource = await session.exec('/system resource print');
    const routerboard = await session.exec('/system routerboard print').catch(() => '');
    const identity = await session.exec('/system identity print').catch(() => '');
    const det = detectRouterOs({ resource, routerboard, identity });
    const res = parseResource(resource);
    const health = parseHealth(await session.exec('/system health print').catch(() => ''));

    const cpuPct = parseCpuLoad(resource);
    const memPct = res.totalMemoryBytes
      ? Math.round((1 - res.freeMemoryBytes / res.totalMemoryBytes) * 100) : null;
    const tempC = health['cpu-temperature'] ?? null;
    const caps = resolveRosCapabilities(det.model);

    await query(
      `UPDATE devices SET hostname=$1, model=$2, serial_number=$3, ios_version=$4,
         uptime_seconds=$5, cpu_pct=$6, mem_pct=$7, temperature_c=$8,
         capabilities=$9, vendor='mikrotik', status='online', last_seen_at=now()
       WHERE id=$10`,
      [det.hostname || device.hostname, det.model || device.model, det.serial, det.version,
       det.uptimeSeconds, cpuPct, memPct, tempC, JSON.stringify(caps), deviceId]);

    await query(
      `INSERT INTO device_metrics (device_id, cpu_pct, mem_pct, temperature_c, poe_watts_used, poe_watts_capacity)
       VALUES ($1,$2,$3,$4,NULL,NULL)`,
      [deviceId, cpuPct, memPct, tempC]);

    if (cpuPct >= 90) await raiseAlert(deviceId, 'cpu_high', 'warning', `${device.hostname} CPU at ${cpuPct}%`);
    else await resolveAlert(deviceId, 'cpu_high');
    if (tempC !== null && tempC >= 70) await raiseAlert(deviceId, 'temp_high', 'critical', `${device.hostname} temperature ${tempC}°C`);
    else await resolveAlert(deviceId, 'temp_high');

    // --- ports (physical ethernet only; bridge/vlan interfaces are virtual) ---
    const ifaces = parseInterfaces(await session.exec('/interface print terse'))
      .filter(i => i.type === 'ether');

    // Live speed/duplex for ports that are up (one monitor call each; usually few).
    const speedByPort = new Map<string, { speed: string; duplex: string }>();
    for (const i of ifaces.filter(p => p.running)) {
      const mon = parseEthernetMonitor(
        await session.exec(`/interface ethernet monitor ${i.name} once`).catch(() => ''));
      speedByPort.set(i.name, {
        speed: mon.rateMbps ? String(mon.rateMbps) : '',
        duplex: mon.fullDuplex ? 'full' : '',
      });
    }

    // MAC table: dynamic, non-local entries grouped by the port they were learnt on.
    const hosts = parseBridgeHosts(await session.exec('/interface bridge host print terse'))
      .filter(h => h.dynamic && !h.local);
    const macsByPort = new Map<string, string[]>();
    for (const h of hosts) {
      if (!macsByPort.has(h.interface)) macsByPort.set(h.interface, []);
      const arr = macsByPort.get(h.interface)!;
      if (arr.length < 50) arr.push(h.mac);
    }

    if (ifaces.length) {
      await query(
        `INSERT INTO ports (device_id, name, description, admin_up, oper_status, vlan, mode, speed, duplex, macs, updated_at)
         SELECT $1, t.name, t.description, t.admin_up, t.oper_status, t.vlan, t.mode, t.speed, t.duplex, t.macs, now()
         FROM jsonb_to_recordset($2::jsonb) AS t(
            name text, description text, admin_up boolean, oper_status text, vlan text,
            mode text, speed text, duplex text, macs jsonb)
         ON CONFLICT (device_id, name) DO UPDATE SET
            description=EXCLUDED.description, admin_up=EXCLUDED.admin_up, oper_status=EXCLUDED.oper_status,
            vlan=EXCLUDED.vlan, mode=EXCLUDED.mode, speed=EXCLUDED.speed, duplex=EXCLUDED.duplex,
            macs=EXCLUDED.macs, updated_at=now()`,
        [deviceId, JSON.stringify(ifaces.map(i => ({
          name: i.name,
          description: i.comment ?? '',
          admin_up: !i.disabled,
          oper_status: i.disabled ? 'disabled' : i.running ? 'connected' : 'notconnect',
          vlan: '1',
          mode: 'access',
          speed: speedByPort.get(i.name)?.speed ?? '',
          duplex: speedByPort.get(i.name)?.duplex ?? '',
          macs: macsByPort.get(i.name) ?? [],
        })))]);
    }

    // --- client tracking (endpoints from the MAC table) ---
    for (const [port, macs] of macsByPort) {
      for (const mac of macs) {
        await query(
          `INSERT INTO client_tracking (device_id, port_name, mac, vlan, vendor, first_seen, last_seen)
           VALUES ($1,$2,$3,1,$4,now(),now())
           ON CONFLICT (device_id, mac) DO UPDATE SET
             port_name=$2, vendor=COALESCE($4, client_tracking.vendor), last_seen=now()`,
          [deviceId, port, mac.toLowerCase(), lookupVendor(mac)]);
      }
    }

    // --- topology neighbors (CDP/LLDP/MNDP via /ip neighbor) ---
    const neighbors = parseNeighbors(await session.exec('/ip neighbor print terse').catch(() => ''));
    await query('DELETE FROM topology_links WHERE device_id=$1', [deviceId]);
    for (const n of neighbors) {
      if (!n.interface || !(n.identity || n.address)) continue;
      await query(
        `INSERT INTO topology_links (device_id, local_port, neighbor_name, neighbor_port, neighbor_ip, neighbor_platform, protocol)
         VALUES ($1,$2,$3,$4,$5,$6,'lldp')
         ON CONFLICT (device_id, local_port, neighbor_name) DO UPDATE SET
           neighbor_port=$4, neighbor_ip=$5, neighbor_platform=$6, updated_at=now()`,
        [deviceId, n.interface, n.identity || n.address, n.board || '', n.address || null, n.platform || '']);
    }

    await redis.set(`device:${deviceId}:lastRefresh`, Date.now().toString()).catch(() => { /* cache only */ });
  });
}

/** True when a device should use the RouterOS refresh path. */
export function isMikrotik(device: Pick<DeviceRow, 'capabilities'> & { vendor?: string }): boolean {
  return device.vendor === 'mikrotik' || (device.capabilities as any)?.os === 'routeros';
}

const safePort = (port: string) => port.replace(/[^\w+\-]/g, '');

/** Live MAC table for one RouterOS port (bridge host entries on that interface). */
export async function routerOsPortMacs(deviceId: string, port: string): Promise<{ mac: string; vlan: number; port: string; type: string }[]> {
  const p = safePort(port);
  if (!p) return [];
  const target = await sshTargetFor(await getDevice(deviceId));
  return withDeviceSession(target, async session => {
    const out = await session.exec(`/interface bridge host print terse where on-interface=${p}`);
    return parseBridgeHosts(out)
      .filter(h => !h.local)
      .map(h => ({ mac: h.mac.toLowerCase(), vlan: 1, port, type: h.dynamic ? 'dynamic' : 'static' }));
  });
}

/** "10", "10,20", "10-12" -> [10], [10,20], [10,11,12]. */
function expandVlanIds(spec: string): number[] {
  const out: number[] = [];
  for (const part of spec.split(',')) {
    const r = part.trim().match(/^(\d+)-(\d+)$/);
    if (r) { for (let i = +r[1]; i <= +r[2]; i++) out.push(i); }
    else if (/^\d+$/.test(part.trim())) out.push(+part.trim());
  }
  return out;
}

/** Bridge VLANs for a RouterOS device, shaped like the Cisco VLAN list. */
export async function routerOsVlans(deviceId: string): Promise<{ id: number; name: string; ports: string[] }[]> {
  const target = await sshTargetFor(await getDevice(deviceId));
  return withDeviceSession(target, async session => {
    const out = await session.exec('/interface bridge vlan print terse');
    const result: { id: number; name: string; ports: string[] }[] = [];
    for (const r of parseTerse(out)) {
      const ports = [...String(r['untagged'] ?? '').split(','), ...String(r['tagged'] ?? '').split(',')].filter(Boolean);
      for (const id of expandVlanIds(String(r['vlan-ids'] ?? ''))) result.push({ id, name: '', ports });
    }
    return result;
  });
}

/**
 * Whether the port's bridge enforces VLANs. RouterOS VLAN assignments are inert
 * until the bridge has vlan-filtering=yes, so the UI warns when it is off.
 * Returns true/false for MikroTik devices, or null when not applicable.
 */
export async function bridgeVlanFiltering(deviceId: string, port: string): Promise<boolean | null> {
  const device = await getDevice(deviceId);
  if (!isMikrotik(device)) return null;
  const safe = port.replace(/[^\w+\-]/g, '');
  if (!safe) return null;
  const target = await sshTargetFor(device);
  return withDeviceSession(target, async session => {
    const out = await session.exec(
      `:local br [/interface bridge port get [find interface=${safe}] bridge]; :put [/interface bridge get $br vlan-filtering]`);
    return /true/i.test(out);
  });
}
