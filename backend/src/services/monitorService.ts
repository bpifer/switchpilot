// Polls devices over SSH/SNMP, updates inventory/port/topology state, raises alerts.
import dns from 'node:dns/promises';
import { query } from '../db.js';
import { redis } from '../redis.js';
import { CiscoSshSession } from '../cisco/sshClient.js';
import { withDeviceSession } from '../cisco/sshPool.js';
import { snmpProbe } from '../cisco/snmpClient.js';
import {
  parseShowVersion, parseInterfacesStatus, parseMacTable, parseCdpNeighborsDetail,
  parseLldpNeighborsDetail, parseCpu, parseMemory, parseEnvironment, parsePowerInline,
  parsePowerInlineTotals, parseShowSwitch, parseInterfaceErrors, parseVlanBrief, parseArpTable
} from '../cisco/parsers.js';
import { resolveCapabilities } from '../cisco/capabilities.js';
import { lookupLifecycle } from '../cisco/lifecycle.js';
import { lookupVendor } from '../cisco/oui.js';
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
  // Pooled session: repeated sweeps reuse the SSH handshake (enable mode is
  // handled by the pool via target.skipEnable for NX-OS).
  await withDeviceSession(target, async session => {
    // --- identity ---
    const ver = parseShowVersion(await session.exec('show version'));
    const caps = ver.model ? resolveCapabilities(ver.model, ver.iosVersion) : device.capabilities;

    // --- health ---
    const os = (caps as any).os as string;
    const cpu = parseCpu(await session.exec('show processes cpu | include CPU utilization'));
    const memCmd = os === 'nxos'
      ? 'show system resources | include Memory'
      : 'show processes memory | include Processor';
    const mem = parseMemory(await session.exec(memCmd));
    const envCmd = os === 'nxos' ? 'show environment' :
                   os === 'iosxe' ? 'show environment all' : 'show env all';
    const env = parseEnvironment(await session.exec(envCmd).catch(() => ''));

    // --- stack ---
    let stack: unknown[] = [];
    if ((caps as any).stacking) {
      stack = parseShowSwitch(await session.exec('show switch').catch(() => ''));
    }

    const resolvedModel = ver.model || device.model;
    const lifecycle = await lookupLifecycle(resolvedModel);

    await query(
      `UPDATE devices SET hostname=$1, model=$2, serial_number=$3, ios_version=$4,
         uptime_seconds=$5, cpu_pct=$6, mem_pct=$7, temperature_c=$8,
         psu_status=$9, fan_status=$10, stack_members=$11, capabilities=$12,
         eos_date=$13, eol_date=$14, recommended_release=$15,
         status='online', last_seen_at=now()
       WHERE id=$16`,
      [ver.hostname || device.hostname, resolvedModel, ver.serial, ver.iosVersion,
       ver.uptimeSeconds, cpu.fiveMin, mem, env.temperatureC,
       JSON.stringify(env.psu), JSON.stringify(env.fans), JSON.stringify(stack),
       JSON.stringify(caps),
       lifecycle?.eos ?? null, lifecycle?.eol ?? null, lifecycle?.recommendedRelease ?? '',
       deviceId]);

    // fetch PoE before device_metrics insert so totals are available
    const poeRaw = (caps as any).poe ? await session.exec('show power inline').catch(() => '') : '';
    const poeTotals = poeRaw ? parsePowerInlineTotals(poeRaw) : null;

    await query(
      `INSERT INTO device_metrics (device_id, cpu_pct, mem_pct, temperature_c, poe_watts_used, poe_watts_capacity)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [deviceId, cpu.fiveMin, mem, env.temperatureC,
       poeTotals?.used ?? null, poeTotals?.capacity ?? null]);

    await evaluateHealthAlerts(deviceId, device.hostname, cpu.fiveMin, mem, env);
    // device is reachable and answering - clear any pre-reload warning
    await resolveAlert(deviceId, 'firmware_reload');

    // --- ports ---
    const ifaces = parseInterfacesStatus(await session.exec('show interfaces status'));
    const macs = parseMacTable(await session.exec('show mac address-table').catch(() => ''));
    const poe = poeRaw ? parsePowerInline(poeRaw) : [];
    const errors = parseInterfaceErrors(
      await session.exec('show interfaces | include (line protocol|input errors|output errors|minute rate)').catch(() => '')
    );

    // ARP table for IP→MAC correlation (layer-3 devices only; access switches have empty ARP tables)
    const arpRaw = (caps as any).layer3
      ? await session.exec('show ip arp').catch(() => '') : '';
    const ipByMac = new Map(parseArpTable(arpRaw).map(e => [e.mac, e.ip]));

    const macsByPort = new Map<string, { macs: string[]; vlan: number }>();
    for (const m of macs) {
      if (m.type.toLowerCase() !== 'dynamic') continue;
      if (!macsByPort.has(m.port)) macsByPort.set(m.port, { macs: [], vlan: m.vlan });
      const entry = macsByPort.get(m.port)!;
      if (entry.macs.length < 50) entry.macs.push(m.mac);
    }
    const poeByPort = new Map(poe.map(p => [p.port, p.watts]));
    const errByPort = new Map(errors.map(e => [shortName(e.name), e]));

    // Previous port state in one query; flap detection runs in JS so the whole
    // port table writes in two batched statements instead of 3 queries per port.
    const prevPorts = await query<{ name: string; oper_status: string; flap_count_1h: number; last_flap_at: string | null }>(
      'SELECT name, oper_status, flap_count_1h, last_flap_at FROM ports WHERE device_id=$1', [deviceId]);
    const prevByName = new Map(prevPorts.rows.map(r => [r.name, r]));

    const portRows = ifaces.map(i => {
      const err = errByPort.get(i.name);
      const prev = prevByName.get(i.name);
      const flapped = !!prev && prev.oper_status !== 'unknown' && prev.oper_status !== i.status;
      const windowExpired = !!prev?.last_flap_at &&
        Date.now() - new Date(prev.last_flap_at).getTime() > 3600_000;
      const flapCount = flapped ? (windowExpired ? 1 : (prev?.flap_count_1h ?? 0) + 1) : (windowExpired ? 0 : prev?.flap_count_1h ?? 0);
      const lastFlapAt = flapped ? new Date().toISOString() : prev?.last_flap_at ?? null;
      return { i, err, flapped, flapCount, lastFlapAt };
    });

    if (portRows.length) {
      await query(
        `INSERT INTO ports (device_id, name, description, admin_up, oper_status, vlan, mode, speed, duplex,
            poe_watts, input_errors, output_errors, macs, last_flap_at, flap_count_1h, updated_at)
         SELECT $1, t.name, t.description, t.admin_up, t.oper_status, t.vlan, t.mode, t.speed, t.duplex,
            t.poe_watts, t.input_errors, t.output_errors, t.macs, t.last_flap_at, t.flap_count_1h, now()
         FROM jsonb_to_recordset($2::jsonb) AS t(
            name text, description text, admin_up boolean, oper_status text, vlan text, mode text,
            speed text, duplex text, poe_watts real, input_errors bigint, output_errors bigint,
            macs jsonb, last_flap_at timestamptz, flap_count_1h int)
         ON CONFLICT (device_id, name) DO UPDATE SET
            description=EXCLUDED.description, admin_up=EXCLUDED.admin_up, oper_status=EXCLUDED.oper_status,
            vlan=EXCLUDED.vlan, mode=EXCLUDED.mode, speed=EXCLUDED.speed, duplex=EXCLUDED.duplex,
            poe_watts=EXCLUDED.poe_watts, input_errors=EXCLUDED.input_errors, output_errors=EXCLUDED.output_errors,
            macs=EXCLUDED.macs, last_flap_at=EXCLUDED.last_flap_at, flap_count_1h=EXCLUDED.flap_count_1h, updated_at=now()`,
        [deviceId, JSON.stringify(portRows.map(({ i, err, flapCount, lastFlapAt }) => ({
          name: i.name, description: i.description, admin_up: i.status !== 'disabled', oper_status: i.status,
          vlan: i.vlan, mode: i.vlan === 'trunk' ? 'trunk' : i.vlan === 'routed' ? 'routed' : 'access',
          speed: i.speed, duplex: i.duplex, poe_watts: poeByPort.get(i.name) ?? null,
          input_errors: err?.inputErrors ?? 0, output_errors: err?.outputErrors ?? 0,
          macs: macsByPort.get(i.name)?.macs ?? [],
          last_flap_at: lastFlapAt, flap_count_1h: flapCount
        })))]);

      // port bandwidth + error metrics, one batched insert
      await query(
        `INSERT INTO port_metrics (device_id, port_name, in_bps, out_bps, in_errors, out_errors, status)
         SELECT $1, t.port_name, t.in_bps, t.out_bps, t.in_errors, t.out_errors, t.status
         FROM jsonb_to_recordset($2::jsonb) AS t(
            port_name text, in_bps bigint, out_bps bigint, in_errors bigint, out_errors bigint, status text)`,
        [deviceId, JSON.stringify(portRows.map(({ i, err }) => ({
          port_name: i.name, in_bps: err?.inBps ?? null, out_bps: err?.outBps ?? null,
          in_errors: err?.inputErrors ?? 0, out_errors: err?.outputErrors ?? 0, status: i.status
        })))]);
    }

    for (const { i, flapped, flapCount } of portRows) {
      const portEntry = macsByPort.get(i.name);

      // client tracking: upsert each dynamic MAC seen on this port, include IP/vendor/PTR if known
      // (stays per-MAC: the reverse-DNS lookup dominates, not the insert)
      if (portEntry) {
        for (const mac of portEntry.macs) {
          const ip = ipByMac.get(mac) ?? null;
          const vendor = lookupVendor(mac);
          let ptr: string | null = null;
          if (ip) {
            try { ptr = (await dns.reverse(ip))[0] ?? null; } catch { /* no PTR record */ }
          }
          await query(
            `INSERT INTO client_tracking (device_id, port_name, mac, vlan, ip_address, vendor, ptr_hostname, first_seen, last_seen)
             VALUES ($1,$2,$3,$4,$5::inet,$6,$7,now(),now())
             ON CONFLICT (device_id, mac) DO UPDATE SET
               port_name=$2, vlan=$4,
               ip_address=COALESCE($5::inet, client_tracking.ip_address),
               vendor=COALESCE($6, client_tracking.vendor),
               ptr_hostname=COALESCE($7, client_tracking.ptr_hostname),
               last_seen=now()`,
            [deviceId, i.name, mac, portEntry.vlan, ip, vendor, ptr]);
        }
      }

      if (flapped && i.status === 'notconnect') {
        await runAutomationTrigger('port_down', { deviceId, port: i.name });
      }
      if (flapCount >= 5) {
        await raiseAlert(deviceId, 'port_flapping', 'warning',
          `${device.hostname} port ${i.name} has flapped ${flapCount} times in the last hour`);
        await runAutomationTrigger('port_flapping', { deviceId, port: i.name, count: flapCount });
      }
    }

    // --- VLAN names ---
    const vlans = parseVlanBrief(await session.exec('show vlan brief').catch(() => ''));
    for (const v of vlans) {
      await query(
        `INSERT INTO device_vlans (device_id, vlan_id, name, ports, updated_at)
         VALUES ($1,$2,$3,$4,now())
         ON CONFLICT (device_id, vlan_id) DO UPDATE SET name=$3, ports=$4, updated_at=now()`,
        [deviceId, v.id, v.name, JSON.stringify(v.ports)]);
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
  });
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
