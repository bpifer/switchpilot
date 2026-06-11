// Polls devices over SSH/SNMP, updates inventory/port/topology state, raises alerts.
import { query } from '../db.js';
import { redis } from '../redis.js';
import { CiscoSshSession } from '../cisco/sshClient.js';
import { snmpProbe } from '../cisco/snmpClient.js';
import {
  parseShowVersion, parseInterfacesStatus, parseMacTable, parseCdpNeighborsDetail,
  parseLldpNeighborsDetail, parseCpu, parseMemory, parseEnvironment, parsePowerInline,
  parseShowSwitch, parseInterfaceErrors
} from '../cisco/parsers.js';
import { resolveCapabilities } from '../cisco/capabilities.js';
import { getDevice, sshTargetFor, snmpTargetFor, type DeviceRow } from './deviceComms.js';
import { raiseAlert, resolveAlert } from './alertService.js';
import { runAutomationTrigger } from './automationService.js';

/** Lightweight reachability check (SNMP first, cheap). Marks online/offline. */
export async function pollStatus(device: DeviceRow): Promise<void> {
  const snmpT = await snmpTargetFor(device);
  let reachable = false;
  if (snmpT) {
    const probe = await snmpProbe(snmpT);
    if (probe) {
      reachable = true;
      await query('UPDATE devices SET uptime_seconds=$1 WHERE id=$2', [probe.uptimeSeconds, device.id]);
    }
  }
  if (!reachable) {
    // fall back to a quick SSH connect
    try {
      const session = new CiscoSshSession({ ...(await sshTargetFor(device)), timeoutMs: 8000 });
      await session.connect();
      session.close();
      reachable = true;
    } catch { /* unreachable */ }
  }

  const newStatus = reachable ? 'online' : 'offline';
  if (device.status !== newStatus) {
    await query('UPDATE devices SET status=$1, last_seen_at=CASE WHEN $1=\'online\' THEN now() ELSE last_seen_at END WHERE id=$2',
      [newStatus, device.id]);
    if (newStatus === 'offline') {
      await raiseAlert(device.id, 'device_offline', 'critical', `${device.hostname} is unreachable via SNMP and SSH`);
      await runAutomationTrigger('device_offline', { deviceId: device.id });
    } else {
      await resolveAlert(device.id, 'device_offline');
    }
  } else if (reachable) {
    await query('UPDATE devices SET last_seen_at=now() WHERE id=$1', [device.id]);
  }
}

/** Full refresh: identity, metrics, environment, ports, PoE, MACs, stack, neighbors. */
export async function refreshDevice(deviceId: string): Promise<void> {
  const device = await getDevice(deviceId);
  const target = await sshTargetFor(device);
  const session = new CiscoSshSession(target);
  await session.connect();
  try {
    await session.enable();

    // --- identity ---
    const ver = parseShowVersion(await session.exec('show version'));
    const caps = ver.model ? resolveCapabilities(ver.model, ver.iosVersion) : device.capabilities;

    // --- health ---
    const cpu = parseCpu(await session.exec('show processes cpu | include CPU utilization'));
    const mem = parseMemory(await session.exec('show processes memory | include Processor'));
    const envCmd = (caps as any).os === 'iosxe' ? 'show environment all' : 'show env all';
    const env = parseEnvironment(await session.exec(envCmd).catch(() => ''));

    // --- stack ---
    let stack: unknown[] = [];
    if ((caps as any).stacking) {
      stack = parseShowSwitch(await session.exec('show switch').catch(() => ''));
    }

    await query(
      `UPDATE devices SET hostname=$1, model=$2, serial_number=$3, ios_version=$4,
         uptime_seconds=$5, cpu_pct=$6, mem_pct=$7, temperature_c=$8,
         psu_status=$9, fan_status=$10, stack_members=$11, capabilities=$12,
         status='online', last_seen_at=now()
       WHERE id=$13`,
      [ver.hostname || device.hostname, ver.model || device.model, ver.serial, ver.iosVersion,
       ver.uptimeSeconds, cpu.fiveMin, mem, env.temperatureC,
       JSON.stringify(env.psu), JSON.stringify(env.fans), JSON.stringify(stack),
       JSON.stringify(caps), deviceId]);

    await query(
      'INSERT INTO device_metrics (device_id, cpu_pct, mem_pct, temperature_c) VALUES ($1,$2,$3,$4)',
      [deviceId, cpu.fiveMin, mem, env.temperatureC]);

    await evaluateHealthAlerts(deviceId, device.hostname, cpu.fiveMin, mem, env);

    // --- ports ---
    const ifaces = parseInterfacesStatus(await session.exec('show interfaces status'));
    const macs = parseMacTable(await session.exec('show mac address-table').catch(() => ''));
    const poe = (caps as any).poe ? parsePowerInline(await session.exec('show power inline').catch(() => '')) : [];
    const errors = parseInterfaceErrors(await session.exec('show interfaces | include (line protocol|input errors|output errors)').catch(() => ''));

    const macsByPort = new Map<string, string[]>();
    for (const m of macs) {
      if (m.type.toLowerCase() !== 'dynamic') continue;
      if (!macsByPort.has(m.port)) macsByPort.set(m.port, []);
      const list = macsByPort.get(m.port)!;
      if (list.length < 50) list.push(m.mac);
    }
    const poeByPort = new Map(poe.map(p => [p.port, p.watts]));
    const errByPort = new Map(errors.map(e => [shortName(e.name), e]));

    for (const i of ifaces) {
      const err = errByPort.get(i.name);
      const prev = await query('SELECT oper_status, flap_count_1h, last_flap_at FROM ports WHERE device_id=$1 AND name=$2', [deviceId, i.name]);
      const flapped = prev.rows[0] && prev.rows[0].oper_status !== 'unknown' && prev.rows[0].oper_status !== i.status;
      const windowExpired = prev.rows[0]?.last_flap_at &&
        Date.now() - new Date(prev.rows[0].last_flap_at).getTime() > 3600_000;
      const flapCount = flapped ? (windowExpired ? 1 : (prev.rows[0]?.flap_count_1h ?? 0) + 1) : (windowExpired ? 0 : prev.rows[0]?.flap_count_1h ?? 0);

      await query(
        `INSERT INTO ports (device_id, name, description, admin_up, oper_status, vlan, mode, speed, duplex,
            poe_watts, input_errors, output_errors, macs, last_flap_at, flap_count_1h, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now())
         ON CONFLICT (device_id, name) DO UPDATE SET
            description=$3, admin_up=$4, oper_status=$5, vlan=$6, mode=$7, speed=$8, duplex=$9,
            poe_watts=$10, input_errors=$11, output_errors=$12, macs=$13,
            last_flap_at=$14, flap_count_1h=$15, updated_at=now()`,
        [deviceId, i.name, i.description, i.status !== 'disabled', i.status,
         i.vlan, i.vlan === 'trunk' ? 'trunk' : i.vlan === 'routed' ? 'routed' : 'access',
         i.speed, i.duplex, poeByPort.get(i.name) ?? null,
         err?.inputErrors ?? 0, err?.outputErrors ?? 0,
         JSON.stringify(macsByPort.get(i.name) ?? []),
         flapped ? new Date() : prev.rows[0]?.last_flap_at ?? null, flapCount]);

      if (flapped && i.status === 'notconnect') {
        await runAutomationTrigger('port_down', { deviceId, port: i.name });
      }
      if (flapCount >= 5) {
        await raiseAlert(deviceId, 'port_flapping', 'warning',
          `${device.hostname} port ${i.name} has flapped ${flapCount} times in the last hour`);
        await runAutomationTrigger('port_flapping', { deviceId, port: i.name, count: flapCount });
      }
    }

    // --- topology neighbors ---
    const cdp = parseCdpNeighborsDetail(await session.exec('show cdp neighbors detail').catch(() => ''));
    const lldp = parseLldpNeighborsDetail(await session.exec('show lldp neighbors detail').catch(() => ''));
    await query('DELETE FROM topology_links WHERE device_id=$1', [deviceId]);
    for (const n of [...cdp.map(n => ({ ...n, protocol: 'cdp' })), ...lldp.map(n => ({ ...n, protocol: 'lldp' }))]) {
      if (!n.localPort || !n.neighborName) continue;
      await query(
        `INSERT INTO topology_links (device_id, local_port, neighbor_name, neighbor_port, neighbor_ip, neighbor_platform, protocol)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (device_id, local_port, neighbor_name) DO UPDATE SET
           neighbor_port=$4, neighbor_ip=$5, neighbor_platform=$6, protocol=$7, updated_at=now()`,
        [deviceId, shortName(n.localPort), n.neighborName, n.neighborPort, n.neighborIp, n.platform, n.protocol]);
    }

    await redis.set(`device:${deviceId}:lastRefresh`, Date.now().toString()).catch(() => { /* cache only */ });
  } finally {
    session.close();
  }
}

async function evaluateHealthAlerts(
  deviceId: string, hostname: string, cpu: number, mem: number,
  env: { temperatureC: number | null; psu: { id: string; status: string }[]; fans: { id: string; status: string }[] }
): Promise<void> {
  if (cpu >= 90) await raiseAlert(deviceId, 'cpu_high', 'warning', `${hostname} CPU at ${cpu}% (5-minute average)`);
  else await resolveAlert(deviceId, 'cpu_high');
  if (cpu >= 90) await runAutomationTrigger('cpu_high', { deviceId, cpu });

  if (mem >= 90) await raiseAlert(deviceId, 'mem_high', 'warning', `${hostname} memory at ${mem}%`);
  else await resolveAlert(deviceId, 'mem_high');

  if (env.temperatureC !== null && env.temperatureC >= 60) {
    await raiseAlert(deviceId, 'temp_high', 'critical', `${hostname} temperature ${env.temperatureC}°C`);
    await runAutomationTrigger('temp_high', { deviceId, temp: env.temperatureC });
  } else {
    await resolveAlert(deviceId, 'temp_high');
  }

  const badPsu = env.psu.filter(p => !/^(ok|good|normal)$/i.test(p.status) && !/not present/i.test(p.status));
  if (badPsu.length) {
    await raiseAlert(deviceId, 'psu_fail', 'critical',
      `${hostname} power supply problem: ${badPsu.map(p => `PSU ${p.id} ${p.status}`).join(', ')}`);
    await runAutomationTrigger('psu_fail', { deviceId });
  } else {
    await resolveAlert(deviceId, 'psu_fail');
  }

  const badFans = env.fans.filter(f => !/^(ok|good|normal)$/i.test(f.status));
  if (badFans.length) {
    await raiseAlert(deviceId, 'fan_fail', 'critical',
      `${hostname} fan problem: ${badFans.map(f => `fan ${f.id} ${f.status}`).join(', ')}`);
    await runAutomationTrigger('fan_fail', { deviceId });
  } else {
    await resolveAlert(deviceId, 'fan_fail');
  }
}

/** GigabitEthernet1/0/1 → Gi1/0/1 to match `show interfaces status` naming. */
function shortName(long: string): string {
  return long
    .replace(/^GigabitEthernet/i, 'Gi').replace(/^FastEthernet/i, 'Fa')
    .replace(/^TenGigabitEthernet/i, 'Te').replace(/^TwoGigabitEthernet/i, 'Tw')
    .replace(/^FortyGigabitEthernet/i, 'Fo').replace(/^HundredGigE/i, 'Hu')
    .replace(/^Port-channel/i, 'Po');
}
