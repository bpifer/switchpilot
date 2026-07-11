// Demo mode: seed a realistic fake fleet so SwitchPilot can be evaluated
// without owning any switches. Gated on DEMO_MODE=true; runs once at startup.
//
// Demo devices are inert by construction:
//   - monitor_enabled=false  -> every scheduler sweep (status, metrics, backup,
//     drift, compliance, cert) skips them, so nothing ever tries to reach them
//   - capabilities.demo=true -> sshTargetFor/snmpTargetFor refuse with a clear
//     message, so manual actions (bounce, config push) fail fast and friendly
//     instead of timing out against an address that doesn't exist
//   - mgmt IPs live in 192.0.2.0/24 (TEST-NET-1, RFC 5737) - never routable
//
// Re-seeding is idempotent: identity rows upsert on the fixed mgmt IPs, and
// time-series data (metrics, last_seen) is refreshed each boot so the demo
// always looks live, not like a snapshot from whenever the image was built.
import crypto from 'node:crypto';
import { query } from '../db.js';

interface DemoPort {
  name: string; description: string; adminUp: boolean;
  status: 'connected' | 'notconnect' | 'disabled';
  vlan: string; mode: 'access' | 'trunk' | 'routed';
  speed: string; duplex: string; poeWatts?: number; macs?: string[];
}

interface DemoDevice {
  hostname: string; ip: string; vendor: 'cisco' | 'mikrotik' | 'aruba';
  model: string; family: string; serial: string; version: string;
  uptimeDays: number; cpu: number | null; mem: number | null; temp: number | null;
  psu: { id: string; status: string }[]; fans: { id: string; status: string }[];
  capabilities: Record<string, unknown>;
  ports: DemoPort[];
}

const gi = (n: number, over: Partial<DemoPort> = {}): DemoPort => ({
  name: `Gi1/0/${n}`, description: '', adminUp: true, status: 'notconnect',
  vlan: '10', mode: 'access', speed: '', duplex: '', ...over,
});

export const DEMO_DEVICES: DemoDevice[] = [
  {
    hostname: 'demo-core-01', ip: '192.0.2.10', vendor: 'cisco',
    model: 'C9300-24P', family: 'catalyst9300', serial: 'FOC2409DEMO',
    version: '17.09.04a', uptimeDays: 147, cpu: 12, mem: 38, temp: 41,
    psu: [{ id: '1A', status: 'OK' }, { id: '1B', status: 'OK' }],
    fans: [{ id: '1/1', status: 'OK' }, { id: '1/2', status: 'OK' }, { id: '1/3', status: 'OK' }],
    capabilities: { demo: true, poe: true, tdr: true, netflow: true, os: 'iosxe' },
    ports: [
      gi(1, { description: 'AP-Lobby', status: 'connected', speed: 'a-1000', duplex: 'a-full', poeWatts: 14.2, macs: ['0c:8d:db:11:22:01'] }),
      gi(2, { description: 'AP-Warehouse', status: 'connected', speed: 'a-1000', duplex: 'a-full', poeWatts: 13.8, macs: ['0c:8d:db:11:22:02'] }),
      gi(3, { description: 'Cam-Entrance', vlan: '30', status: 'connected', speed: 'a-100', duplex: 'a-full', poeWatts: 6.4, macs: ['9c:8e:cd:44:55:01'] }),
      gi(4, { description: 'Cam-Parking', vlan: '30', status: 'connected', speed: 'a-100', duplex: 'a-full', poeWatts: 6.1, macs: ['9c:8e:cd:44:55:02'] }),
      gi(5, { description: 'Printer-Front', vlan: '20', status: 'connected', speed: 'a-1000', duplex: 'a-full', macs: ['00:17:c8:aa:bb:01'] }),
      ...Array.from({ length: 17 }, (_, i) => gi(i + 6)),
      gi(23, { description: 'reserved - do not use', adminUp: false, status: 'disabled', vlan: '999' }),
      gi(24, { description: 'Uplink SP-ACCESS', vlan: 'trunk', mode: 'trunk', status: 'connected', speed: 'a-1000', duplex: 'a-full' }),
      { name: 'Te1/1/1', description: 'Uplink demo-lab-rtr', adminUp: true, status: 'connected', vlan: 'trunk', mode: 'trunk', speed: '10G', duplex: 'full' },
      { name: 'Te1/1/2', description: 'Uplink demo-office-sw', adminUp: true, status: 'connected', vlan: 'trunk', mode: 'trunk', speed: '10G', duplex: 'full' },
    ],
  },
  {
    hostname: 'demo-access-01', ip: '192.0.2.11', vendor: 'cisco',
    model: 'WS-C2960X-24PS-L', family: 'catalyst2960', serial: 'FCW1932DEMO',
    version: '15.2(7)E7', uptimeDays: 312, cpu: 9, mem: 27, temp: 33,
    psu: [{ id: '1', status: 'Good' }], fans: [{ id: 'system', status: 'OK' }],
    capabilities: { demo: true, poe: true, os: 'ios' },
    ports: [
      gi(1, { description: 'Desk-101', status: 'connected', speed: 'a-1000', duplex: 'a-full', macs: ['3c:52:82:70:01:01'] }),
      gi(2, { description: 'Desk-102', status: 'connected', speed: 'a-1000', duplex: 'a-full', macs: ['3c:52:82:70:01:02'] }),
      gi(3, { description: 'Desk-103 (docking)', status: 'connected', speed: 'a-1000', duplex: 'a-full', macs: ['3c:52:82:70:01:03', 'f4:ce:46:9a:00:11'] }),
      gi(4, { description: 'Phone-Reception', vlan: '20', status: 'connected', speed: 'a-100', duplex: 'a-full', poeWatts: 4.9, macs: ['00:1b:4f:33:44:01'] }),
      ...Array.from({ length: 19 }, (_, i) => gi(i + 5)),
      gi(24, { description: 'Uplink demo-core-01', vlan: 'trunk', mode: 'trunk', status: 'connected', speed: 'a-1000', duplex: 'a-full' }),
    ],
  },
  {
    hostname: 'demo-lab-rtr', ip: '192.0.2.12', vendor: 'mikrotik',
    model: 'CRS326-24G-2S+', family: '', serial: 'HCE08DEMO',
    version: '7.16.1', uptimeDays: 88, cpu: 4, mem: 18, temp: 39,
    psu: [{ id: '1', status: 'OK' }], fans: [],
    capabilities: { demo: true, os: 'routeros' },
    ports: [
      ...Array.from({ length: 6 }, (_, i): DemoPort => ({
        name: `ether${i + 1}`, description: i === 0 ? 'lab-server-1' : i === 1 ? 'lab-server-2' : '',
        adminUp: true, status: i < 2 ? 'connected' : 'notconnect',
        vlan: '1', mode: 'access', speed: i < 2 ? '1Gbps' : '', duplex: i < 2 ? 'full' : '',
        macs: i === 0 ? ['18:66:da:00:aa:01'] : i === 1 ? ['18:66:da:00:aa:02'] : undefined,
      })),
      { name: 'sfp-sfpplus1', description: 'Uplink demo-core-01', adminUp: true, status: 'connected', vlan: 'trunk', mode: 'trunk', speed: '10Gbps', duplex: 'full' },
    ],
  },
  {
    hostname: 'demo-office-sw', ip: '192.0.2.13', vendor: 'aruba',
    model: 'Aruba Instant On 1930 24G', family: '', serial: 'CN2AKDEMO',
    version: '2.8.11', uptimeDays: 65,
    // Instant On exposes no health OIDs (confirmed on real hardware) - the
    // demo mirrors that honestly so the "not reported" UI path shows too.
    cpu: null, mem: null, temp: null,
    psu: [], fans: [],
    capabilities: { demo: true, os: 'aos-instanton', transport: 'snmp' },
    ports: [
      ...Array.from({ length: 8 }, (_, i): DemoPort => ({
        name: `${i + 1}`, description: i === 0 ? 'Conference-TV' : i === 1 ? 'Guest-AP' : '',
        adminUp: true, status: i < 2 ? 'connected' : 'notconnect',
        vlan: i === 1 ? '40' : '10', mode: 'access',
        speed: i < 2 ? '1000' : '', duplex: i < 2 ? 'full' : '',
        macs: i === 0 ? ['a0:d3:c1:55:66:01'] : i === 1 ? ['0c:8d:db:11:22:03'] : undefined,
      })),
      { name: '25', description: 'Uplink demo-core-01', adminUp: true, status: 'connected', vlan: 'trunk', mode: 'trunk', speed: '1000', duplex: 'full' },
    ],
  },
];

// endpoint rows: [device hostname, port, mac, ip last octet, vendor, ptr]
const DEMO_CLIENTS: [string, string, string, number, string, string][] = [
  ['demo-core-01', 'Gi1/0/1', '0c:8d:db:11:22:01', 101, 'Cisco Meraki', 'ap-lobby.demo.lan'],
  ['demo-core-01', 'Gi1/0/2', '0c:8d:db:11:22:02', 102, 'Cisco Meraki', 'ap-warehouse.demo.lan'],
  ['demo-core-01', 'Gi1/0/3', '9c:8e:cd:44:55:01', 103, 'Axis Communications', 'cam-entrance.demo.lan'],
  ['demo-core-01', 'Gi1/0/4', '9c:8e:cd:44:55:02', 104, 'Axis Communications', 'cam-parking.demo.lan'],
  ['demo-core-01', 'Gi1/0/5', '00:17:c8:aa:bb:01', 105, 'Kyocera', 'printer-front.demo.lan'],
  ['demo-access-01', 'Gi1/0/1', '3c:52:82:70:01:01', 111, 'HP', 'desk-101.demo.lan'],
  ['demo-access-01', 'Gi1/0/2', '3c:52:82:70:01:02', 112, 'HP', 'desk-102.demo.lan'],
  ['demo-access-01', 'Gi1/0/3', 'f4:ce:46:9a:00:11', 113, 'HP', 'desk-103.demo.lan'],
  ['demo-access-01', 'Gi1/0/4', '00:1b:4f:33:44:01', 114, 'Avaya', 'phone-reception.demo.lan'],
  ['demo-lab-rtr', 'ether1', '18:66:da:00:aa:01', 121, 'Dell', 'lab-server-1.demo.lan'],
  ['demo-lab-rtr', 'ether2', '18:66:da:00:aa:02', 122, 'Dell', 'lab-server-2.demo.lan'],
  ['demo-office-sw', '1', 'a0:d3:c1:55:66:01', 131, 'LG Electronics', 'conference-tv.demo.lan'],
];

// links: [device, local port, neighbor hostname, neighbor port, protocol]
const DEMO_LINKS: [string, string, string, string, 'cdp' | 'lldp'][] = [
  ['demo-core-01', 'Gi1/0/24', 'demo-access-01', 'Gi1/0/24', 'cdp'],
  ['demo-access-01', 'Gi1/0/24', 'demo-core-01', 'Gi1/0/24', 'cdp'],
  ['demo-core-01', 'Te1/1/1', 'demo-lab-rtr', 'sfp-sfpplus1', 'lldp'],
  ['demo-lab-rtr', 'sfp-sfpplus1', 'demo-core-01', 'Te1/1/1', 'lldp'],
  ['demo-core-01', 'Te1/1/2', 'demo-office-sw', '25', 'lldp'],
  ['demo-office-sw', '25', 'demo-core-01', 'Te1/1/2', 'lldp'],
];

const DEMO_CORE_CONFIG_V1 = `hostname demo-core-01
!
vlan 10
 name USERS
vlan 20
 name VOICE
vlan 30
 name CAMERAS
!
interface GigabitEthernet1/0/1
 description AP-Lobby
 switchport access vlan 10
!
interface GigabitEthernet1/0/24
 description Uplink SP-ACCESS
 switchport mode trunk
!
line vty 0 4
 transport input ssh
end
`;

// v2 adds a VLAN + hardens the VTYs, so the demo diff/history view has a
// meaningful change to show.
const DEMO_CORE_CONFIG_V2 = DEMO_CORE_CONFIG_V1.replace(
  `vlan 30
 name CAMERAS`,
  `vlan 30
 name CAMERAS
vlan 40
 name GUEST`
).replace(
  `line vty 0 4
 transport input ssh`,
  `line vty 0 4
 transport input ssh
 exec-timeout 10 0`
);

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** True when any demo device is already present. */
async function demoDevicesExist(): Promise<boolean> {
  const { rows } = await query(`SELECT 1 FROM devices WHERE capabilities->>'demo' = 'true' LIMIT 1`);
  return rows.length > 0;
}

export async function seedDemoFleet(log: (msg: string) => void = console.log): Promise<void> {
  const firstRun = !(await demoDevicesExist());

  const { rows: siteRows } = await query<{ id: string }>(
    `INSERT INTO sites (name, address) VALUES ('Demo Lab', '100 Example Way')
     ON CONFLICT (name) DO UPDATE SET address = EXCLUDED.address
     RETURNING id`);
  const siteId = siteRows[0].id;

  const idByHostname = new Map<string, string>();
  for (const d of DEMO_DEVICES) {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO devices (hostname, mgmt_ip, vendor, model, family, serial_number, ios_version,
                            site_id, location, status, last_seen_at, uptime_seconds,
                            cpu_pct, mem_pct, temperature_c, psu_status, fan_status,
                            capabilities, monitor_enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Demo rack','online',now(),$9,$10,$11,$12,$13,$14,$15,FALSE)
       ON CONFLICT (mgmt_ip) DO UPDATE SET
         hostname=EXCLUDED.hostname, status='online', last_seen_at=now(),
         uptime_seconds=EXCLUDED.uptime_seconds, cpu_pct=EXCLUDED.cpu_pct,
         mem_pct=EXCLUDED.mem_pct, temperature_c=EXCLUDED.temperature_c,
         capabilities=EXCLUDED.capabilities, monitor_enabled=FALSE
       RETURNING id`,
      [d.hostname, d.ip, d.vendor, d.model, d.family, d.serial, d.version, siteId,
       d.uptimeDays * 86400, d.cpu, d.mem, d.temp,
       JSON.stringify(d.psu), JSON.stringify(d.fans), JSON.stringify(d.capabilities)]);
    idByHostname.set(d.hostname, rows[0].id);

    for (const p of d.ports) {
      await query(
        `INSERT INTO ports (device_id, name, description, admin_up, oper_status, vlan, mode,
                            speed, duplex, poe_watts, macs)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (device_id, name) DO UPDATE SET
           description=EXCLUDED.description, admin_up=EXCLUDED.admin_up,
           oper_status=EXCLUDED.oper_status, vlan=EXCLUDED.vlan, mode=EXCLUDED.mode,
           speed=EXCLUDED.speed, duplex=EXCLUDED.duplex, poe_watts=EXCLUDED.poe_watts,
           macs=EXCLUDED.macs, updated_at=now()`,
        [rows[0].id, p.name, p.description, p.adminUp, p.status, p.vlan, p.mode,
         p.speed, p.duplex, p.poeWatts ?? null, JSON.stringify(p.macs ?? [])]);
    }
  }

  for (const [host, localPort, neighbor, neighborPort, protocol] of DEMO_LINKS) {
    const devId = idByHostname.get(host)!;
    const neighborIp = DEMO_DEVICES.find(d => d.hostname === neighbor)?.ip ?? '';
    await query(
      `INSERT INTO topology_links (device_id, local_port, neighbor_name, neighbor_port, neighbor_ip, neighbor_platform, protocol)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (device_id, local_port, neighbor_name) DO UPDATE SET
         neighbor_port=EXCLUDED.neighbor_port, updated_at=now()`,
      [devId, localPort, neighbor, neighborPort, neighborIp,
       DEMO_DEVICES.find(d => d.hostname === neighbor)?.model ?? '', protocol]);
  }

  for (const [host, port, mac, lastOctet, vendor, ptr] of DEMO_CLIENTS) {
    await query(
      `INSERT INTO client_tracking (device_id, port_name, mac, vlan, ip_address, vendor, ptr_hostname, first_seen, last_seen)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now() - interval '30 days', now())
       ON CONFLICT (device_id, mac) DO UPDATE SET last_seen=now(), ip_address=EXCLUDED.ip_address`,
      [idByHostname.get(host)!, port, mac, 10, `192.0.2.${lastOctet}`, vendor, ptr]);
  }

  // 48h of metrics at 15-min resolution, regenerated each boot so charts look
  // live. Gentle daily sine + per-row jitter; Aruba stays honestly NULL.
  await query(`DELETE FROM device_metrics WHERE device_id = ANY($1)`, [[...idByHostname.values()]]);
  for (const d of DEMO_DEVICES) {
    await query(
      `INSERT INTO device_metrics (device_id, ts, cpu_pct, mem_pct, temperature_c, poe_watts_used, poe_watts_capacity)
       SELECT $1, ts,
              CASE WHEN $2::real IS NULL THEN NULL
                   ELSE round(($2 + 6 * sin(extract(epoch FROM ts) / 13750.0) + random() * 3)::numeric, 1) END,
              CASE WHEN $3::real IS NULL THEN NULL
                   ELSE round(($3 + 2 * sin(extract(epoch FROM ts) / 27500.0) + random())::numeric, 1) END,
              CASE WHEN $4::real IS NULL THEN NULL
                   ELSE round(($4 + 3 * sin(extract(epoch FROM ts) / 13750.0) + random() * 1.5)::numeric, 1) END,
              CASE WHEN $5 THEN 41 + round((random() * 4)::numeric, 1) ELSE NULL END,
              CASE WHEN $5 THEN 435 ELSE NULL END
       FROM generate_series(now() - interval '48 hours', now(), interval '15 minutes') ts`,
      [idByHostname.get(d.hostname)!, d.cpu, d.mem, d.temp, Boolean((d.capabilities as any).poe)]);
  }

  // One-time content: alerts and config history (skipped on refresh boots so
  // acknowledged/resolved state and history don't multiply).
  if (firstRun) {
    const accessId = idByHostname.get('demo-access-01')!;
    const coreId = idByHostname.get('demo-core-01')!;
    await query(
      `INSERT INTO alerts (device_id, severity, kind, message, created_at)
       VALUES ($1, 'warning', 'port_flapping', 'Gi1/0/3 on demo-access-01 flapped 6 times in the last hour', now() - interval '3 hours')`,
      [accessId]);
    await query(
      `INSERT INTO alerts (device_id, severity, kind, message, created_at, resolved_at)
       VALUES ($1, 'critical', 'device_offline', 'demo-access-01 is unreachable via SNMP and SSH', now() - interval '2 days', now() - interval '47 hours')`,
      [accessId]);

    await query(
      `INSERT INTO config_backups (device_id, kind, content, sha256, taken_by, created_at)
       VALUES ($1,'running',$2,$3,'scheduler', now() - interval '14 days'),
              ($1,'running',$4,$5,'scheduler', now() - interval '2 days')`,
      [coreId, DEMO_CORE_CONFIG_V1, sha256(DEMO_CORE_CONFIG_V1),
       DEMO_CORE_CONFIG_V2, sha256(DEMO_CORE_CONFIG_V2)]);
  }

  log(`demo mode: seeded ${DEMO_DEVICES.length} demo devices (${firstRun ? 'first run' : 'refreshed'})`);
}
