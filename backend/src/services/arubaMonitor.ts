// Aruba Instant On device refresh (phase 1: SNMP read-only). Mirrors
// ciscoMonitor/routerosMonitor but reads standard MIBs instead of an SSH shell:
// identity from system/ENTITY, ports from IF-MIB (with bps computed from HC
// octet deltas between sweeps, previous counters cached in redis), and LLDP
// neighbors into topology_links. Writes the same shared tables so the rest of
// the app stays vendor-agnostic. vendor: aruba.
import { query } from '../db.js';
import { redis } from '../redis.js';
import { snmpGet, snmpWalk, OIDS, type SnmpTarget } from '../cisco/snmpClient.js';
import {
  ARUBA_OIDS, detectAruba, mapInterfaces, computeRates, mapLldpNeighbors,
  type CounterSnapshot,
} from '../aruba/snmp.js';
import { getDevice, snmpTargetFor, type DeviceRow } from './deviceComms.js';
import { publishDevice } from './mqttService.js';
import { decidePortFlap } from './monitorShared.js';
import { raiseAlert, resolveAlert } from './alertService.js';
import { runAutomationTrigger } from './automationService.js';

/** SNMP-managed Aruba gear routes here instead of an SSH monitor. */
export function isAruba(device: Pick<DeviceRow, 'capabilities'> & { vendor?: string }): boolean {
  return device.vendor === 'aruba' || (device.capabilities as any)?.os === 'aos-instanton';
}

const RATES_KEY = (id: string) => `device:${id}:snmpCounters`;

/** Full Instant On refresh over SNMP. */
export async function refreshArubaDevice(deviceId: string): Promise<void> {
  const device = await getDevice(deviceId);
  const target = await snmpTargetFor(device);
  if (!target) throw new Error('Aruba monitoring needs an SNMP community/v3 profile on the device credential');

  // --- identity ---
  const sys = await snmpGet(target, [ARUBA_OIDS.sysDescr, ARUBA_OIDS.sysName, ARUBA_OIDS.sysUpTime]);
  const sysDescr = String(sys[ARUBA_OIDS.sysDescr] ?? '');
  const det = detectAruba(sysDescr);
  // Walk entPhysicalClass to find the chassis row (class=3); its index varies
  // by vendor (the 1930 uses ~67109120, not the conventional .1 or .1000).
  const entClass = await snmpWalk(target, OIDS.entPhysicalClass).catch(() => ({} as Record<string, string | number>));
  const chassisSuffix = Object.entries(entClass).find(([, v]) => Number(v) === 3)?.[0]?.split('.').pop() ?? '1';
  const ent = await snmpGet(target, [
    `${OIDS.entPhysicalModelName}.${chassisSuffix}`,
    `${OIDS.entPhysicalSerialNum}.${chassisSuffix}`,
  ]).catch(() => ({} as Record<string, string | number>));
  const model = String(ent[`${OIDS.entPhysicalModelName}.1`] ?? '') || det.model || device.model;
  const serial = String(ent[`${OIDS.entPhysicalSerialNum}.1`] ?? '') || device.serial_number || '';

  await query(
    `UPDATE devices SET hostname=$1, model=$2, serial_number=$3, ios_version=$4,
       uptime_seconds=$5, capabilities=$6, vendor='aruba', status='online', last_seen_at=now()
     WHERE id=$7`,
    [String(sys[ARUBA_OIDS.sysName] ?? '').split('.')[0] || device.hostname, model, serial,
     det.version || device.ios_version || '',
     Math.floor(Number(sys[ARUBA_OIDS.sysUpTime] ?? 0) / 100),
     JSON.stringify({ ...(device.capabilities as any ?? {}), os: 'aos-instanton', transport: 'snmp' }),
     deviceId]);

  // CPU/memory/temperature: the 1930's vendor OIDs are unconfirmed until the
  // hardware session - nulls keep the metrics series honest instead of fake 0s.
  await query(
    `INSERT INTO device_metrics (device_id, cpu_pct, mem_pct, temperature_c, poe_watts_used, poe_watts_capacity)
     VALUES ($1,NULL,NULL,NULL,NULL,NULL)`, [deviceId]);

  // --- ports (IF-MIB) ---
  const [ifType, ifName, ifAlias, ifHighSpeed, ifAdminStatus, ifOperStatus, ifHCInOctets, ifHCOutOctets] =
    await Promise.all([
      snmpWalk(target, ARUBA_OIDS.ifType), snmpWalk(target, ARUBA_OIDS.ifName),
      snmpWalk(target, ARUBA_OIDS.ifAlias), snmpWalk(target, ARUBA_OIDS.ifHighSpeed),
      snmpWalk(target, ARUBA_OIDS.ifAdminStatus), snmpWalk(target, ARUBA_OIDS.ifOperStatus),
      snmpWalk(target, ARUBA_OIDS.ifHCInOctets), snmpWalk(target, ARUBA_OIDS.ifHCOutOctets),
    ]);
  const ifaces = mapInterfaces({ ifType, ifName, ifAlias, ifHighSpeed, ifAdminStatus, ifOperStatus, ifHCInOctets, ifHCOutOctets });

  // bps from HC octet deltas vs the previous sweep (redis-cached snapshot)
  const cur: CounterSnapshot = {
    ts: Date.now(),
    counters: Object.fromEntries(ifaces.map(i => [i.index, { in: i.inOctets, out: i.outOctets }])),
  };
  let prev: CounterSnapshot | null = null;
  try { prev = JSON.parse((await redis.get(RATES_KEY(deviceId))) ?? 'null'); } catch { /* fresh start */ }
  const rates = computeRates(prev, cur);
  await redis.set(RATES_KEY(deviceId), JSON.stringify(cur), 'EX', 3600).catch(() => { /* cache only */ });

  // Previous port state for flap detection (same batched pattern as ciscoMonitor).
  const prevPorts = await query<{ name: string; oper_status: string; flap_count_1h: number; last_flap_at: string | null }>(
    'SELECT name, oper_status, flap_count_1h, last_flap_at FROM ports WHERE device_id=$1', [deviceId]);
  const prevByName = new Map(prevPorts.rows.map(r => [r.name, r]));
  const portRows = ifaces.map(i => ({ i, ...decidePortFlap(prevByName.get(i.name), i.operStatus) }));

  if (portRows.length) {
    await query(
      `INSERT INTO ports (device_id, name, description, admin_up, oper_status, vlan, mode, speed, duplex,
          poe_watts, input_errors, output_errors, macs, last_flap_at, flap_count_1h, media, updated_at)
       SELECT $1, t.name, t.description, t.admin_up, t.oper_status, '', 'access', t.speed, '',
          NULL, 0, 0, '[]'::jsonb, t.last_flap_at, t.flap_count_1h, '', now()
       FROM jsonb_to_recordset($2::jsonb) AS t(
          name text, description text, admin_up boolean, oper_status text, speed text,
          last_flap_at timestamptz, flap_count_1h int)
       ON CONFLICT (device_id, name) DO UPDATE SET
          description=EXCLUDED.description, admin_up=EXCLUDED.admin_up, oper_status=EXCLUDED.oper_status,
          speed=EXCLUDED.speed, last_flap_at=EXCLUDED.last_flap_at, flap_count_1h=EXCLUDED.flap_count_1h,
          updated_at=now()`,
      [deviceId, JSON.stringify(portRows.map(({ i, flapCount, lastFlapAt }) => ({
        name: i.name, description: i.description, admin_up: i.adminUp, oper_status: i.operStatus,
        speed: i.speedMbps != null ? (i.speedMbps >= 1000 ? `${i.speedMbps / 1000}G` : `${i.speedMbps}M`) : '',
        last_flap_at: lastFlapAt, flap_count_1h: flapCount,
      })))]);

    await query(
      `INSERT INTO port_metrics (device_id, port_name, in_bps, out_bps, in_errors, out_errors, status)
       SELECT $1, t.port_name, t.in_bps, t.out_bps, 0, 0, t.status
       FROM jsonb_to_recordset($2::jsonb) AS t(
          port_name text, in_bps bigint, out_bps bigint, status text)`,
      [deviceId, JSON.stringify(portRows.map(({ i }) => ({
        port_name: i.name,
        in_bps: rates[i.index]?.inBps ?? null, out_bps: rates[i.index]?.outBps ?? null,
        status: i.operStatus,
      })))]);
  }

  for (const { i, flapped, flapCount } of portRows) {
    if (flapped && i.operStatus === 'notconnect') {
      await runAutomationTrigger('port_down', { deviceId, port: i.name });
    }
    if (flapCount >= 5) {
      await raiseAlert(deviceId, 'port_flapping', 'warning',
        `${device.hostname} port ${i.name} has flapped ${flapCount} times in the last hour`);
      await runAutomationTrigger('port_flapping', { deviceId, port: i.name, count: flapCount });
    }
  }
  await resolveAlert(deviceId, 'device_offline');

  // --- LLDP neighbors (best-effort; some agents ship with LLDP MIB disabled) ---
  try {
    const [sysName, portId, portDesc, sysDesc] = await Promise.all([
      snmpWalk(target, ARUBA_OIDS.lldpRemSysName), snmpWalk(target, ARUBA_OIDS.lldpRemPortId),
      snmpWalk(target, ARUBA_OIDS.lldpRemPortDesc), snmpWalk(target, ARUBA_OIDS.lldpRemSysDesc),
    ]);
    const byIndex = new Map(ifaces.map(i => [i.index, i.name]));
    const neighbors = mapLldpNeighbors({ sysName, portId, portDesc, sysDesc });
    await query('DELETE FROM topology_links WHERE device_id=$1', [deviceId]);
    for (const n of neighbors) {
      await query(
        `INSERT INTO topology_links (device_id, local_port, neighbor_name, neighbor_port, neighbor_ip, neighbor_platform, protocol)
         VALUES ($1,$2,$3,$4,NULL,$5,'lldp')
         ON CONFLICT (device_id, local_port, neighbor_name) DO UPDATE SET
           neighbor_port=$4, neighbor_platform=$5, updated_at=now()`,
        [deviceId, byIndex.get(n.localPortNum) ?? `port ${n.localPortNum}`, n.neighborName, n.neighborPort, n.platform]);
    }
  } catch { /* LLDP MIB unavailable - topology just stays empty for this device */ }

  await redis.set(`device:${deviceId}:lastRefresh`, Date.now().toString()).catch(() => { /* cache only */ });
  publishDevice(deviceId).catch(() => { /* mqtt best-effort */ });
}
