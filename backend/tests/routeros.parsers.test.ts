import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseTerse, parseResource, parseRouterboard, parsePackageUpdate, parseInterfaces,
  parseBridgeHosts, parseIpAddresses, parseNeighbors, parseHealth,
  parseEthernetMonitor, parseSize, parseRate,
} from '../src/routeros/parsers.js';
import { isRouterOs, detectRouterOs, parseUptime } from '../src/routeros/detector.js';
import { resolveRosCapabilities, portsFromBoardName } from '../src/routeros/capabilities.js';

const fx = (n: string) => readFileSync(new URL(`./fixtures/routeros/${n}`, import.meta.url), 'utf8');

describe('routeros terse tokenizer', () => {
  it('keeps spaces inside unquoted values (e.g. timestamps)', () => {
    const [r] = parseTerse('23 RS name=ether24 last-link-up-time=2026-06-14 08:38:41 link-downs=0');
    expect(r.index).toBe(23);
    expect(r.flags).toEqual(['R', 'S']);
    expect(r['name']).toBe('ether24');
    expect(r['last-link-up-time']).toBe('2026-06-14 08:38:41');
    expect(r['link-downs']).toBe('0');
  });

  it('parses spaced flags like "D E" and bare "DL"', () => {
    expect(parseTerse('0 D E mac-address=AA:BB')[0].flags).toEqual(['D', 'E']);
    expect(parseTerse('3 DL  mac-address=AA:BB')[0].flags).toEqual(['D', 'L']);
  });
});

describe('parseResource / detection', () => {
  const out = fx('resource.txt');
  it('extracts board, version, memory', () => {
    const r = parseResource(out);
    expect(r.platform).toBe('MikroTik');
    expect(r.boardName).toBe('CRS326-24G-2S+');
    expect(r.version).toBe('7.12.1');
    expect(r.architecture).toBe('arm');
    expect(r.totalMemoryBytes).toBe(Math.round(512 * 1024 ** 2));
  });
  it('isRouterOs is true for MikroTik platform', () => {
    expect(isRouterOs(out)).toBe(true);
    expect(isRouterOs('platform: Cisco')).toBe(false);
  });
});

describe('parseRouterboard', () => {
  it('extracts model and serial', () => {
    const r = parseRouterboard(fx('routerboard.txt'));
    expect(r.model).toBe('CRS326-24G-2S+');
    expect(r.serialNumber).toBe('HCX08CX227Y');
    expect(r.upgradeFirmware).toBe('7.12.1');
  });
  it('flags a routerboard firmware upgrade when current != bundled (real CRS326)', () => {
    const r = parseRouterboard(fx('routerboard.txt'));
    // real device: bootloader 6.48.6 behind the 7.12.1 bundled with the OS
    expect(r.currentFirmware).toBe('6.48.6');
    expect(r.upgradeFirmware).not.toBe(r.currentFirmware);
  });
});

describe('parsePackageUpdate', () => {
  it('parses installed/channel from `package update print` (real CRS326)', () => {
    const u = parsePackageUpdate('            channel: stable\n  installed-version: 7.12.1');
    expect(u).toEqual({ channel: 'stable', installedVersion: '7.12.1', latestVersion: '', status: '' });
  });
  it('parses a newer version + status after check-for-updates', () => {
    const u = parsePackageUpdate(
      'channel: stable\ninstalled-version: 7.12.1\nlatest-version: 7.15.3\nstatus: New version is available');
    expect(u.latestVersion).toBe('7.15.3');
    expect(u.status).toMatch(/new version/i);
  });
});

describe('parseInterfaces', () => {
  const ifs = parseInterfaces(fx('interface-terse.txt'));
  it('reads names, types, and link state from flags', () => {
    const e1 = ifs.find(i => i.name === 'ether1')!;
    expect(e1.type).toBe('ether');
    expect(e1.running).toBe(false);
    expect(e1.slave).toBe(true);

    const e24 = ifs.find(i => i.name === 'ether24')!;
    expect(e24.running).toBe(true);          // RS flags
    expect(e24.macAddress).toBe('18:FD:74:6D:40:8D');

    const br = ifs.find(i => i.name === 'bridgeLocal')!;
    expect(br.type).toBe('bridge');
    expect(br.running).toBe(true);
    expect(br.comment).toBe('defconf');
  });
  it('includes the SFP+ ports', () => {
    expect(ifs.filter(i => i.name.startsWith('sfp-sfpplus'))).toHaveLength(2);
  });
});

describe('parseBridgeHosts (MAC table)', () => {
  const hosts = parseBridgeHosts(fx('host-terse.txt'));
  it('parses every entry', () => {
    expect(hosts).toHaveLength(12);
  });
  it('flags the device-local MACs (L) so endpoints can be filtered', () => {
    const endpoints = hosts.filter(h => !h.local);
    expect(endpoints).toHaveLength(10);                 // 12 total - 2 local
    expect(endpoints.every(h => h.dynamic)).toBe(true);
    expect(endpoints.find(h => h.mac === 'BC:24:11:00:24:61')?.interface).toBe('ether24');
  });
});

describe('parseIpAddresses', () => {
  it('splits the management address from its prefix', () => {
    const [a] = parseIpAddresses(fx('ip-terse.txt'));
    expect(a.ip).toBe('192.168.10.41');
    expect(a.address).toBe('192.168.10.41/24');
    expect(a.interface).toBe('bridgeLocal');
  });
});

describe('parseNeighbors', () => {
  it('returns [] for empty output (no neighbors discovered)', () => {
    expect(parseNeighbors('')).toEqual([]);
    expect(parseNeighbors('\n  \n')).toEqual([]);
  });
});

describe('parseHealth / monitor', () => {
  it('reads the cpu temperature from columnar output', () => {
    expect(parseHealth(fx('health.txt'))['cpu-temperature']).toBe(56);
  });
  it('reads link status and rate from monitor output', () => {
    const m = parseEthernetMonitor(fx('monitor.txt'));
    expect(m.status).toBe('link-ok');
    expect(m.up).toBe(true);
    expect(m.rateMbps).toBe(1000);
    expect(m.fullDuplex).toBe(true);
  });
});

describe('unit helpers', () => {
  it('parseSize handles MiB/GiB', () => {
    expect(parseSize('451.4MiB')).toBe(Math.round(451.4 * 1024 ** 2));
    expect(parseSize('15.8MiB')).toBe(Math.round(15.8 * 1024 ** 2));
  });
  it('parseRate maps Gbps/Mbps to Mbps', () => {
    expect(parseRate('1Gbps')).toBe(1000);
    expect(parseRate('100Mbps')).toBe(100);
    expect(parseRate('10Gbps')).toBe(10000);
    expect(parseRate(undefined)).toBeNull();
  });
  it('parseUptime sums weeks/days/hours/min/sec', () => {
    expect(parseUptime('12m8s')).toBe(12 * 60 + 8);
    expect(parseUptime('1w2d3h4m5s')).toBe(604800 + 2 * 86400 + 3 * 3600 + 4 * 60 + 5);
  });
});

describe('capabilities + detection wiring', () => {
  it('derives port counts from the board-name', () => {
    expect(portsFromBoardName('CRS326-24G-2S+')).toEqual({ gigabit: 24, sfp: 0, sfpPlus: 2 });
  });
  it('resolves CRS326 capabilities (24x1G + 2xSFP+, no PoE)', () => {
    const caps = resolveRosCapabilities('CRS326-24G-2S+');
    expect(caps.os).toBe('routeros');
    expect(caps.gigabitPorts).toBe(24);
    expect(caps.sfpPlusPorts).toBe(2);
    expect(caps.ports).toBe(26);
    expect(caps.poe).toBe(false);
  });
  it('detectRouterOs assembles a full identity', () => {
    const d = detectRouterOs({
      resource: fx('resource.txt'),
      routerboard: fx('routerboard.txt'),
      identity: '  name: MikroTik\n',
    });
    expect(d.vendor).toBe('mikrotik');
    expect(d.model).toBe('CRS326-24G-2S+');
    expect(d.serial).toBe('HCX08CX227Y');
    expect(d.version).toBe('7.12.1');
    expect(d.hostname).toBe('MikroTik');
    expect((d.capabilities as any).sfpPlusPorts).toBe(2);
  });
});
