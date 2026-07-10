// Full refreshCiscoDevice sweep against the mock SSH device: the real SSH
// pool, session state machine, parsers, and capability gating run end-to-end;
// only the DB/redis/alert/automation/mqtt edges are mocked. The seam is
// capabilities.sshPort (honored by sshTargetFor), which points the sweep at
// the mock listening on an ephemeral 127.0.0.1 port.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

const queryCalls: { sql: string; params: any[] }[] = [];
let credRow: any = null;
vi.mock('../src/db.js', () => ({
  query: vi.fn(async (sql: string, params: any[] = []) => {
    queryCalls.push({ sql, params });
    if (/FROM credentials/.test(sql)) return { rows: credRow ? [credRow] : [] };
    return { rows: [] };
  }),
}));
const redisSet = vi.fn(async () => {});
vi.mock('../src/redis.js', () => ({
  redis: { get: vi.fn(async () => null), set: (...a: any[]) => redisSet(...a) },
}));
vi.mock('../src/services/alertService.js', () => ({
  raiseAlert: vi.fn(async () => {}),
  resolveAlert: vi.fn(async () => {}),
}));
vi.mock('../src/services/automationService.js', () => ({
  runAutomationTrigger: vi.fn(async () => {}),
}));
vi.mock('../src/services/mqttService.js', () => ({
  publishDevice: vi.fn(async () => {}),
}));

import { refreshCiscoDevice } from '../src/services/ciscoMonitor.js';
import { evictDevice } from '../src/cisco/sshPool.js';
import { encryptSecret } from '../src/crypto/secrets.js';
import { startMockDevice, type RunningMock } from './helpers/mockCiscoDevice.js';
import * as fx from './fixtures/cisco.js';

let mock: RunningMock;

const deviceRow = (port: number): any => ({
  id: 'dev-1',
  hostname: 'stale-name',
  mgmt_ip: '127.0.0.1',
  model: '',
  family: '',
  vendor: 'cisco',
  credential_id: 'cred-1',
  capabilities: { sshPort: port },
  ssh_host_key_fp: '',      // unpinned: first connect pins (TOFU)
});

beforeAll(async () => {
  mock = await startMockDevice({
    hostname: 'core-sw-01',
    responses: {
      'show version': fx.SHOW_VERSION_IOSXE,
      'show processes cpu | include CPU utilization': fx.SHOW_PROCESSES_CPU,
      'show processes memory | include Processor': fx.SHOW_PROCESSES_MEMORY,
      'show environment all': fx.SHOW_ENV_IOSXE,
      'show power inline': fx.SHOW_POWER_INLINE,
      'show interfaces status': fx.SHOW_INTERFACES_STATUS,
      'show mac address-table': fx.SHOW_MAC_TABLE,
      'show vlan brief': fx.SHOW_VLAN_BRIEF,
      'show cdp neighbors detail': fx.SHOW_CDP_DETAIL,
      // 'show ip arp' deliberately unset (empty): no IPs -> no reverse-DNS I/O
    },
  });
  credRow = {
    id: 'cred-1',
    ssh_username: 'admin',
    ssh_password_enc: encryptSecret('x'),
    enable_password_enc: '',
  };
});

afterAll(async () => {
  evictDevice({ host: '127.0.0.1', port: mock.port, username: 'admin', password: 'x' });
  await mock.close();
});

const callsMatching = (re: RegExp) => queryCalls.filter(c => re.test(c.sql));

describe('refreshCiscoDevice against the mock device (full sweep)', () => {
  it('runs the whole read path and writes every shared table', async () => {
    await refreshCiscoDevice(deviceRow(mock.port));

    // identity: parsed from show version, not the stale DB row
    const devUpdate = callsMatching(/UPDATE devices SET hostname/)[0];
    expect(devUpdate).toBeDefined();
    const [hostname, model, serial, iosVersion] = devUpdate.params;
    expect(hostname).toBe('core-sw-01');
    expect(model).toBe('C9300-48P');
    expect(serial).toBe('FCW2145L0AB');
    expect(iosVersion).toBe('17.12.03');   // parser takes the banner's first version line

    // capability gating resolved from the model: PoE on a -48P, sshPort kept
    const caps = JSON.parse(devUpdate.params[11]);
    expect(caps.os).toBe('iosxe');
    expect(caps.poe).toBe(true);
    expect(caps.sshPort).toBe(mock.port);

    // health metrics parsed and inserted (cpu 11% five-minute from the fixture)
    const metrics = callsMatching(/INSERT INTO device_metrics/)[0];
    expect(metrics.params[1]).toBe(11);

    // ports: one batched upsert with all six fixture ports, correctly typed
    const portsInsert = callsMatching(/INSERT INTO ports/)[0];
    const rows = JSON.parse(portsInsert.params[1]);
    expect(rows).toHaveLength(6);
    const byName = new Map(rows.map((r: any) => [r.name, r]));
    expect((byName.get('Gi1/0/1') as any).mode).toBe('trunk');
    expect((byName.get('Te1/1/1') as any).mode).toBe('routed');
    expect((byName.get('Gi1/0/5') as any).admin_up).toBe(false);
    expect((byName.get('Gi1/0/4') as any).poe_watts).toBe(15.4);
    // dynamic MACs land on their port; STATIC entries are filtered out
    expect((byName.get('Gi1/0/2') as any).macs).toEqual(['aabb.cc00.2002']);

    // port_metrics batch insert exists for the same six ports
    const pm = callsMatching(/INSERT INTO port_metrics/)[0];
    expect(JSON.parse(pm.params[1])).toHaveLength(6);

    // client tracking: one row per dynamic MAC (3 in the fixture)
    expect(callsMatching(/INSERT INTO client_tracking/)).toHaveLength(3);

    // VLAN names from show vlan brief
    const vlanIds = callsMatching(/INSERT INTO device_vlans/).map(c => c.params[1]);
    expect(vlanIds).toEqual([1, 10, 20, 99]);

    // topology: CDP neighbor upserted after the per-device delete
    expect(callsMatching(/DELETE FROM topology_links/)).toHaveLength(1);
    const topo = callsMatching(/INSERT INTO topology_links/);
    expect(topo.length).toBeGreaterThanOrEqual(1);
    expect(topo[0].params[2]).toMatch(/core-rtr-01/);

    // host key pinned on first connect (TOFU) and refresh timestamp cached
    expect(callsMatching(/ssh_host_key_fp=\$1/).length).toBeGreaterThanOrEqual(1);
    expect(redisSet).toHaveBeenCalledWith('device:dev-1:lastRefresh', expect.any(String));

    // the whole sweep shares one pooled SSH connection
    expect(mock.connectionCount()).toBe(1);
  });

  it('a second sweep reuses the pooled session instead of reconnecting', async () => {
    queryCalls.length = 0;
    await refreshCiscoDevice(deviceRow(mock.port));
    expect(callsMatching(/UPDATE devices SET hostname/)).toHaveLength(1);
    expect(mock.connectionCount()).toBe(1);   // still the first connection
  });
});
