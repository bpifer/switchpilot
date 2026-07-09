import { describe, it, expect } from 'vitest';
import { ARUBA_OIDS, mapPvids, type Walk } from '../src/aruba/snmp.js';
import { renderArubaConfig } from '../src/aruba/syntheticConfig.js';
import { evaluateRule, type ComplianceRule } from '../src/services/complianceService.js';

// ── mapPvids ─────────────────────────────────────────────────────────────────

describe('mapPvids', () => {
  it('joins dot1qPvid (bridge port) to ifIndex via dot1dBasePortIfIndex', () => {
    const basePortIfIndex: Walk = {
      [`${ARUBA_OIDS.dot1dBasePortIfIndex}.1`]: 1,
      [`${ARUBA_OIDS.dot1dBasePortIfIndex}.2`]: 2,
      [`${ARUBA_OIDS.dot1dBasePortIfIndex}.49`]: 49,
    };
    const pvid: Walk = {
      [`${ARUBA_OIDS.dot1qPvid}.1`]: 10,
      [`${ARUBA_OIDS.dot1qPvid}.2`]: 1,
      [`${ARUBA_OIDS.dot1qPvid}.49`]: 100,
    };
    const m = mapPvids({ pvid, basePortIfIndex });
    expect(m.get(1)).toBe(10);
    expect(m.get(2)).toBe(1);
    expect(m.get(49)).toBe(100);
  });

  it('skips bridge ports missing from the base-port map and zero VLANs', () => {
    const basePortIfIndex: Walk = { [`${ARUBA_OIDS.dot1dBasePortIfIndex}.1`]: 1 };
    const pvid: Walk = {
      [`${ARUBA_OIDS.dot1qPvid}.1`]: 0,   // vlan 0: invalid
      [`${ARUBA_OIDS.dot1qPvid}.2`]: 20,  // no base-port row
    };
    expect(mapPvids({ pvid, basePortIfIndex }).size).toBe(0);
  });
});

// ── renderArubaConfig ─────────────────────────────────────────────────────────

const IDENTITY = { hostname: 'SW-LAB-01', model: 'Aruba Instant On 1930 24G Switch', version: '2.8.0.0' };
const PORTS = [
  { name: '10', description: '', admin_up: true, oper_status: 'notconnect', vlan: '1' },
  { name: '1', description: 'uplink to core', admin_up: true, oper_status: 'connected', vlan: '100' },
  { name: '2', description: 'NAS', admin_up: true, oper_status: 'connected', vlan: '10' },
  { name: '3', description: '', admin_up: false, oper_status: 'disabled', vlan: '1' },
];
const NEIGHBORS = [{ local_port: '1', neighbor_name: 'core-sw', neighbor_port: 'Gi1/0/28' }];

describe('renderArubaConfig', () => {
  it('renders identity, one line per port (naturally sorted), and lldp neighbors', () => {
    const cfg = renderArubaConfig(IDENTITY, PORTS, NEIGHBORS);
    expect(cfg).toContain('hostname SW-LAB-01');
    expect(cfg).toContain('version 2.8.0.0');
    expect(cfg).toContain('interface 1 name "uplink to core" vlan 100 enabled connected');
    expect(cfg).toContain('interface 3 name "" vlan 1 disabled disabled');
    expect(cfg).toContain('lldp neighbor local-port 1 name core-sw port Gi1/0/28');
    // natural sort: port 2 before port 10
    expect(cfg.indexOf('interface 2 ')).toBeLessThan(cfg.indexOf('interface 10 '));
    expect(cfg.trimEnd().endsWith('end')).toBe(true);
  });

  it('omits the vlan token when the PVID is unknown', () => {
    const cfg = renderArubaConfig(IDENTITY,
      [{ name: '1', description: '', admin_up: true, oper_status: 'connected', vlan: '' }], []);
    expect(cfg).toContain('interface 1 name "" enabled connected');
  });
});

// ── Seeded rule patterns vs the synthetic format ──────────────────────────────
// Patterns duplicated from migrations/032_aruba_compliance.sql - if a change
// here is needed, the migration (and renderer) must change with it.

const rule = (match_type: ComplianceRule['match_type'], pattern: string): ComplianceRule => ({
  id: 't', name: 't', description: '', severity: 'info', match_type, pattern,
  remediation: '', site_id: null, enabled: true,
});

const R = {
  noVlan1: rule('regex_absent', '^interface \\S+ name "[^"]*" vlan 1 enabled connected$'),
  descriptions: rule('regex_absent', '^interface \\S+ name "" .*connected$'),
  hostname: rule('regex_absent', '^hostname\\s*($|Aruba|[Ss]witch)'),
  lldp: rule('regex_present', '^lldp neighbor '),
  version: rule('regex_present', '^version \\S'),
};

describe('Aruba compliance rules against synthetic config', () => {
  it('a hardened device passes all five rules', () => {
    const cfg = renderArubaConfig(IDENTITY, PORTS, NEIGHBORS);
    // notconnect ports on VLAN 1 are fine - only CONNECTED default-VLAN ports fail
    expect(evaluateRule(R.noVlan1, cfg).passed).toBe(true);
    expect(evaluateRule(R.descriptions, cfg).passed).toBe(true);
    expect(evaluateRule(R.hostname, cfg).passed).toBe(true);
    expect(evaluateRule(R.lldp, cfg).passed).toBe(true);
    expect(evaluateRule(R.version, cfg).passed).toBe(true);
  });

  it('fails a connected port left on VLAN 1', () => {
    const cfg = renderArubaConfig(IDENTITY,
      [{ name: '5', description: 'printer', admin_up: true, oper_status: 'connected', vlan: '1' }], NEIGHBORS);
    const r = evaluateRule(R.noVlan1, cfg);
    expect(r.passed).toBe(false);
    expect(r.detail).toContain('interface 5');
  });

  it('does not confuse VLAN 10 with VLAN 1', () => {
    const cfg = renderArubaConfig(IDENTITY,
      [{ name: '5', description: 'ok', admin_up: true, oper_status: 'connected', vlan: '10' }], NEIGHBORS);
    expect(evaluateRule(R.noVlan1, cfg).passed).toBe(true);
  });

  it('fails a connected port without a description', () => {
    const cfg = renderArubaConfig(IDENTITY,
      [{ name: '7', description: '', admin_up: true, oper_status: 'connected', vlan: '20' }], NEIGHBORS);
    expect(evaluateRule(R.descriptions, cfg).passed).toBe(false);
    // an EMPTY notconnect port is fine
    const idle = renderArubaConfig(IDENTITY,
      [{ name: '7', description: '', admin_up: true, oper_status: 'notconnect', vlan: '20' }], NEIGHBORS);
    expect(evaluateRule(R.descriptions, idle).passed).toBe(true);
  });

  it('fails factory-default hostnames', () => {
    for (const bad of ['Aruba-1930-ABCDEF', 'Switch', 'switch1', '']) {
      const cfg = renderArubaConfig({ ...IDENTITY, hostname: bad }, PORTS, NEIGHBORS);
      expect(evaluateRule(R.hostname, cfg).passed, `hostname "${bad}"`).toBe(false);
    }
  });

  it('fails when no LLDP neighbors are visible and when firmware is unknown', () => {
    const cfg = renderArubaConfig({ ...IDENTITY, version: '' }, PORTS, []);
    expect(evaluateRule(R.lldp, cfg).passed).toBe(false);
    expect(evaluateRule(R.version, cfg).passed).toBe(false);
  });
});
