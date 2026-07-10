// backupDevice's Aruba branch: renders the synthetic snapshot from DB state
// (never SSH), dedupes on the normalized hash, and skips devices that have
// never polled. The renderer itself is covered in aruba.compliance.test.ts;
// this exercises the configService wiring around it.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryCalls: { sql: string; params: any[] }[] = [];
let portRows: any[] = [];
let latestBackup: { id: string; sha256: string } | null = null;
vi.mock('../src/db.js', () => ({
  query: vi.fn(async (sql: string, params: any[] = []) => {
    queryCalls.push({ sql, params });
    if (/FROM ports/.test(sql)) return { rows: portRows };
    if (/FROM topology_links/.test(sql)) return { rows: [{ local_port: '1', neighbor_name: 'core', neighbor_port: 'Gi1/0/1' }] };
    if (/FROM config_backups WHERE device_id/.test(sql)) return { rows: latestBackup ? [latestBackup] : [] };
    if (/INSERT INTO config_backups/.test(sql)) return { rows: [{ id: 'backup-1' }] };
    if (/FROM devices d LEFT JOIN sites/.test(sql)) return { rows: [{ hostname: 'AR-LAB', site_name: null }] };
    return { rows: [] };
  }),
}));

const deviceExec = vi.fn(async () => ({}));
vi.mock('../src/services/deviceComms.js', () => ({
  deviceExec: (...a: any[]) => deviceExec(...a),
  devicePushConfig: vi.fn(),
  getDevice: vi.fn(async () => ({
    id: 'dev-a', vendor: 'aruba', hostname: 'AR-LAB', model: 'Aruba Instant On 1930 24G Switch',
    ios_version: '2.8.0.0', mgmt_ip: '10.0.0.5', capabilities: {},
  })),
}));
vi.mock('../src/services/configVersioning.js', () => ({
  commitConfig: vi.fn(async () => 'git-sha-1'),
}));
vi.mock('../src/services/alertService.js', () => ({
  raiseAlert: vi.fn(), resolveAlert: vi.fn(),
}));
vi.mock('../src/services/configPreview.js', () => ({
  previewConfigLines: vi.fn(),
}));

import { backupDevice } from '../src/services/configService.js';

beforeEach(() => {
  queryCalls.length = 0;
  latestBackup = null;
  portRows = [
    { name: '1', description: 'uplink', admin_up: true, oper_status: 'connected', vlan: '100' },
    { name: '2', description: '', admin_up: true, oper_status: 'notconnect', vlan: '1' },
  ];
  deviceExec.mockClear();
});

describe('backupDevice for Aruba (synthetic snapshot)', () => {
  it('renders from DB state and stores a backup without touching SSH', async () => {
    const r = await backupDevice('dev-a', 'tester', { reason: 'unit test' });
    expect(r.changed).toBe(true);
    expect(r.id).toBe('backup-1');
    expect(deviceExec).not.toHaveBeenCalled();

    const insert = queryCalls.find(c => /INSERT INTO config_backups/.test(c.sql))!;
    const content: string = insert.params[1];
    expect(content).toContain('hostname AR-LAB');
    expect(content).toContain('version 2.8.0.0');
    expect(content).toContain('interface 1 name "uplink" vlan 100 enabled connected');
    expect(content).toContain('lldp neighbor local-port 1 name core port Gi1/0/1');
  });

  it('skips quietly when the device has never completed a poll (no port rows)', async () => {
    portRows = [];
    const r = await backupDevice('dev-a', 'tester');
    expect(r).toEqual({ id: '', changed: false });
    expect(queryCalls.some(c => /INSERT INTO config_backups/.test(c.sql))).toBe(false);
  });

  it('dedupes an unchanged snapshot against the latest backup hash', async () => {
    // First run captures the hash the service computes for this state.
    await backupDevice('dev-a', 'tester');
    const firstInsert = queryCalls.find(c => /INSERT INTO config_backups/.test(c.sql))!;
    const hash: string = firstInsert.params[2];

    queryCalls.length = 0;
    latestBackup = { id: 'backup-1', sha256: hash };
    const r = await backupDevice('dev-a', 'tester');
    expect(r).toEqual({ id: 'backup-1', changed: false });
    expect(queryCalls.some(c => /INSERT INTO config_backups/.test(c.sql))).toBe(false);
  });
});
