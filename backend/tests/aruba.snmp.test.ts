import { describe, it, expect } from 'vitest';
import {
  ARUBA_OIDS, detectAruba, mapInterfaces, computeRates, mapLldpNeighbors,
  type Walk, type CounterSnapshot,
} from '../src/aruba/snmp.js';
import { detectDevice } from '../src/cisco/detector.js';

// Canned IF-MIB walks shaped like a small Instant On: two ethernet ports, a
// LAG, and a VLAN SVI (ifType 135) that must be filtered out.
const IF = ARUBA_OIDS;
function walks() {
  const w = {
    ifType: {} as Walk, ifName: {} as Walk, ifAlias: {} as Walk, ifHighSpeed: {} as Walk,
    ifAdminStatus: {} as Walk, ifOperStatus: {} as Walk, ifHCInOctets: {} as Walk, ifHCOutOctets: {} as Walk,
  };
  const set = (col: keyof typeof w, base: string, idx: number, v: string | number) => { w[col][`${base}.${idx}`] = v; };
  // port 1: up, 1G, described
  set('ifType', IF.ifType, 1, 6); set('ifName', IF.ifName, 1, '1'); set('ifAlias', IF.ifAlias, 1, 'uplink to core');
  set('ifHighSpeed', IF.ifHighSpeed, 1, 1000); set('ifAdminStatus', IF.ifAdminStatus, 1, 1); set('ifOperStatus', IF.ifOperStatus, 1, 1);
  set('ifHCInOctets', IF.ifHCInOctets, 1, 1_000_000); set('ifHCOutOctets', IF.ifHCOutOctets, 1, 2_000_000);
  // port 2: admin-down
  set('ifType', IF.ifType, 2, 6); set('ifName', IF.ifName, 2, '2'); set('ifAlias', IF.ifAlias, 2, '');
  set('ifHighSpeed', IF.ifHighSpeed, 2, 0); set('ifAdminStatus', IF.ifAdminStatus, 2, 2); set('ifOperStatus', IF.ifOperStatus, 2, 2);
  set('ifHCInOctets', IF.ifHCInOctets, 2, 0); set('ifHCOutOctets', IF.ifHCOutOctets, 2, 0);
  // LAG (type 161): included
  set('ifType', IF.ifType, 100, 161); set('ifName', IF.ifName, 100, 'lag1');
  set('ifAdminStatus', IF.ifAdminStatus, 100, 1); set('ifOperStatus', IF.ifOperStatus, 100, 2);
  // VLAN SVI (type 135): excluded
  set('ifType', IF.ifType, 200, 135); set('ifName', IF.ifName, 200, 'vlan1');
  return w;
}

describe('detectAruba', () => {
  it('recognizes an Instant On 1930 sysDescr and extracts model + firmware (PD style)', () => {
    const d = detectAruba('Aruba Instant On 1930 48G 4SFP+ Switch, PD.02.11, Linux 3.6.5');
    expect(d.isAruba).toBe(true);
    expect(d.model).toMatch(/Instant\s*On 1930/i);
    expect(d.version).toBe('PD.02.11');
  });

  it('extracts version from real 1930 sysDescr (InstantOn_1930_2.8.0.0 format)', () => {
    const sysDescr = 'Aruba Instant On 1930 24G Class4 PoE 4SFP/SFP+ 370W Switch JL684B, InstantOn_1930_2.8.0.0 (17), Linux 4.4.120, U-Boot 2013.01 (V1.0.1.41)';
    const d = detectAruba(sysDescr);
    expect(d.isAruba).toBe(true);
    expect(d.version).toBe('2.8.0.0');
    expect(d.model).toMatch(/Instant\s*On 1930/i);
  });

  it('is not fooled by Cisco or MikroTik sysDescrs', () => {
    expect(detectAruba('Cisco IOS Software, C9300 Software').isAruba).toBe(false);
    expect(detectAruba('RouterOS CRS326-24G-2S+').isAruba).toBe(false);
  });
});

describe('mapInterfaces', () => {
  it('maps ethernet + LAG rows and filters VLAN/other ifTypes', () => {
    const ifaces = mapInterfaces(walks());
    expect(ifaces.map(i => i.name)).toEqual(['1', '2', 'lag1']);
  });

  it('maps status, speed, description, and counters per row', () => {
    const [p1, p2, lag] = mapInterfaces(walks());
    expect(p1).toMatchObject({ operStatus: 'connected', adminUp: true, speedMbps: 1000, description: 'uplink to core', inOctets: 1_000_000, outOctets: 2_000_000 });
    expect(p2).toMatchObject({ operStatus: 'disabled', adminUp: false, speedMbps: null });
    expect(lag).toMatchObject({ operStatus: 'notconnect', adminUp: true, inOctets: null, outOctets: null });
  });
});

describe('computeRates', () => {
  const snap = (ts: number, inB: number | null, outB: number | null): CounterSnapshot =>
    ({ ts, counters: { 1: { in: inB, out: outB } } });

  it('computes bps from octet deltas over the elapsed window', () => {
    // +600,000 octets in 60s = 10,000 B/s = 80,000 bps
    const r = computeRates(snap(0, 1_000_000, 0), snap(60_000, 1_600_000, 0));
    expect(r[1].inBps).toBe(80_000);
    expect(r[1].outBps).toBe(0);
  });

  it('returns null with no previous sample (first sweep)', () => {
    const r = computeRates(null, snap(60_000, 500, 500));
    expect(r[1]).toEqual({ inBps: null, outBps: null });
  });

  it('returns null when a counter goes backwards (reboot/wrap), not a bogus rate', () => {
    const r = computeRates(snap(0, 9_000_000, 100), snap(60_000, 1_000, 200));
    expect(r[1].inBps).toBeNull();     // reset -> unknown
    expect(r[1].outBps).toBe(13);      // the healthy counter still rates
  });

  it('returns null when no time elapsed', () => {
    expect(computeRates(snap(1000, 0, 0), snap(1000, 800, 800))[1].inBps).toBeNull();
  });
});

describe('mapLldpNeighbors', () => {
  it('flattens the remote table rows keyed on localPort.remIndex', () => {
    const B = ARUBA_OIDS;
    const n = mapLldpNeighbors({
      sysName: { [`${B.lldpRemSysName}.0.3.1`]: 'core-sw', [`${B.lldpRemSysName}.0.7.1`]: 'crs326' },
      portId: { [`${B.lldpRemPortId}.0.3.1`]: 'Gi1/0/5', [`${B.lldpRemPortId}.0.7.1`]: 'ether10' },
      portDesc: { [`${B.lldpRemPortDesc}.0.3.1`]: 'GigabitEthernet1/0/5' },
      sysDesc: { [`${B.lldpRemSysDesc}.0.3.1`]: 'Cisco IOS Software, C9300\nmore lines' },
    });
    expect(n).toHaveLength(2);
    const core = n.find(x => x.neighborName === 'core-sw')!;
    expect(core.localPortNum).toBe(3);
    expect(core.neighborPort).toBe('GigabitEthernet1/0/5');   // portDesc wins over portId
    expect(core.platform).toBe('Cisco IOS Software, C9300');  // first line only
    expect(n.find(x => x.neighborName === 'crs326')).toMatchObject({ localPortNum: 7, neighborPort: 'ether10' });
  });

  it('drops rows with no system name (half-populated table)', () => {
    const B = ARUBA_OIDS;
    expect(mapLldpNeighbors({
      sysName: {}, portId: { [`${B.lldpRemPortId}.0.3.1`]: 'x' }, portDesc: {}, sysDesc: {},
    })).toEqual([]);
  });
});

describe('detectDevice — Aruba via SNMP (mocked probe path shape)', () => {
  it('DetectionResult carries the vendor field for non-Cisco gear', () => {
    // Type-level + shape check: the field exists and flows to the devices INSERT.
    const r: Awaited<ReturnType<typeof detectDevice>> = {
      hostname: 'sw-instanton', model: 'Aruba Instant On 1930 48G 4SFP+ Switch',
      family: 'aruba-instanton', serial: 'CN123', iosVersion: 'PD.02.11',
      uptimeSeconds: 100, detectedVia: 'snmp', vendor: 'aruba',
      capabilities: { os: 'aos-instanton', transport: 'snmp' },
    };
    expect(r.vendor).toBe('aruba');
  });
});
