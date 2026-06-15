import { describe, it, expect } from 'vitest';
import { routerosDriver } from '../src/drivers/routeros.js';
import { driverFor } from '../src/drivers/index.js';
import { ciscoDriver } from '../src/drivers/cisco.js';

describe('routerosDriver', () => {
  const ros = routerosDriver();

  it('has no enable step and no explicit save (auto-persists)', () => {
    expect(ros.vendor).toBe('mikrotik');
    expect(ros.os).toBe('routeros');
    expect(ros.skipEnable).toBe(true);
    expect(ros.saveCommand).toBe('');
  });

  it('enables/disables a port via the interface selector', () => {
    expect(ros.setPortAdmin('ether1', false)).toEqual(['/interface/set [find name=ether1] disabled=yes']);
    expect(ros.setPortAdmin('ether1', true)).toEqual(['/interface/set [find name=ether1] disabled=no']);
  });

  it('bounces a port by disable then enable', () => {
    expect(ros.bounceLines('sfp-sfpplus1')).toEqual({
      down: ['/interface/set [find name=sfp-sfpplus1] disabled=yes'],
      up: ['/interface/set [find name=sfp-sfpplus1] disabled=no'],
    });
  });

  it('maps a trap level onto one rule per topic (RouterOS ANDs topics in a rule)', () => {
    // a single multi-topic rule would match nothing, so each severity is its own rule
    expect(ros.loggingTrap('warnings')).toEqual([
      '/system/logging/remove [find action=switchpilot]',
      '/system/logging/add action=switchpilot topics=warning',
      '/system/logging/add action=switchpilot topics=error',
      '/system/logging/add action=switchpilot topics=critical',
    ]);
    expect(ros.loggingTrap('critical')).toEqual([
      '/system/logging/remove [find action=switchpilot]',
      '/system/logging/add action=switchpilot topics=critical',
    ]);
  });

  it('builds a baseline with discovery, remote logging (per-topic rules), and SNMP v2c', () => {
    const plan = ros.baseline({ snmpVersion: '2c', snmpCommunity: 'mon-RO_1', platformHost: '192.168.10.226' });
    expect(plan.lines).toContain('/ip/neighbor/discovery-settings/set discover-interface-list=all');
    expect(plan.lines.some(l => l.includes('logging/action/find name=switchpilot') && l.includes('remote=192.168.10.226'))).toBe(true);
    expect(plan.lines).toContain('/system/logging/add action=switchpilot topics=info');
    expect(plan.lines).toContain('/system/logging/add action=switchpilot topics=critical');
    expect(plan.lines).toContain('/snmp/community/add name=mon-RO_1 addresses=0.0.0.0/0 read-access=yes');
    expect(plan.lines).toContain('/snmp/set enabled=yes');
  });

  it('rejects SNMP communities with unsafe characters', () => {
    const plan = ros.baseline({ snmpVersion: '2c', snmpCommunity: 'public; /user/add', platformHost: null });
    expect(plan.lines.some(l => l.includes('/snmp/community/add'))).toBe(false);
    expect(plan.notes.some(n => n.includes('unsafe'))).toBe(true);
  });

  it('skips syslog forwarding when no platform host is known', () => {
    const plan = ros.baseline({ platformHost: null });
    expect(plan.lines.some(l => l.includes('/system/logging'))).toBe(false);
    expect(plan.notes.some(n => n.includes('PLATFORM_URL not set'))).toBe(true);
  });

  it('still refuses the cable test (per-model TDR) but no longer port config', () => {
    expect(() => ros.cableTest('ether1')).toThrow(/not yet supported/i);
    expect(() => ros.portConfig('ether1', { mode: 'access', vlan: 20 })).not.toThrow();
  });

  it('rejects invalid port names', () => {
    expect(() => ros.portConfig('ether1; /user add', { vlan: 20 })).toThrow(/invalid RouterOS port name/i);
  });
});

describe('routerosDriver.portConfig (bridge VLAN)', () => {
  const ros = routerosDriver();

  it('access VLAN: sets pvid, strips the port from other VLANs, re-adds untagged', () => {
    const [script] = ros.portConfig('ether5', { mode: 'access', vlan: 20 });
    expect(script).toContain('pvid=20');
    expect(script).toContain('frame-types=admit-only-untagged-and-priority-tagged');
    expect(script).toContain('bridge vlan find where bridge=$br'); // strip loop
    expect(script).toContain('vlan-ids=20 untagged=$p');           // ensure-add branch
  });

  it('access VLAN derives the bridge from the port (no hardcoded bridge name)', () => {
    const [script] = ros.portConfig('ether5', { vlan: 30 });
    expect(script).toContain(':local br [/interface bridge port get [find interface=$p] bridge]');
  });

  it('trunk: native untagged + each allowed VLAN tagged, native excluded from allowed', () => {
    const [script] = ros.portConfig('sfp-sfpplus1', {
      mode: 'trunk', trunkNativeVlan: 1, trunkAllowedVlans: '10,20,30-31',
    });
    expect(script).toContain('pvid=1 frame-types=admit-all');
    expect(script).toContain(':foreach vv in={10;20;30;31}');
    expect(script).toContain('tagged=$p');
  });

  it('description and forced speed/duplex emit ethernet set lines', () => {
    const lines = ros.portConfig('ether2', { description: 'AP uplink', speed: '1000', duplex: 'full' });
    expect(lines).toContain('/interface ethernet set [find default-name=ether2] comment="AP uplink"');
    expect(lines.some(l => l.includes('auto-negotiation=no') && l.includes('speed=1Gbps') && l.includes('full-duplex=yes'))).toBe(true);
  });

  it('strips quotes and newlines from a comment so it cannot break out / inject', () => {
    const [line] = ros.portConfig('ether1', { description: 'ap"\n/user add name=evil group=full' });
    expect(line).toBe('/interface ethernet set [find default-name=ether1] comment="ap\' /user add name=evil group=full"');
    expect(/[\r\n]/.test(line)).toBe(false);
  });

  it('portfast/bpduGuard map to the bridge port', () => {
    const lines = ros.portConfig('ether2', { portfast: true, bpduGuard: true });
    expect(lines.some(l => l.includes('bridge port set [find interface=ether2]') && l.includes('edge=yes') && l.includes('bpdu-guard=yes'))).toBe(true);
  });
});

describe('driverFor vendor dispatch', () => {
  it('selects the RouterOS driver by vendor or by routeros os', () => {
    expect(driverFor({ vendor: 'mikrotik' }).os).toBe('routeros');
    expect(driverFor({ capabilities: { os: 'routeros' } }).vendor).toBe('mikrotik');
  });

  it('still selects Cisco for the default and NX-OS cases', () => {
    expect(driverFor({}).vendor).toBe('cisco');
    expect(driverFor({ capabilities: { os: 'nxos' } }).saveCommand).toBe('copy running-config startup-config');
  });
});

describe('ciscoDriver baseline parity', () => {
  it('produces the same IOS lines the inline plan used to', () => {
    const plan = ciscoDriver('ios').baseline({ snmpVersion: '2c', snmpCommunity: 'mon-RO_1', platformHost: '192.168.10.226' });
    expect(plan.lines).toEqual([
      'lldp run',
      'logging host 192.168.10.226',
      'logging trap informational',
      'snmp-server community mon-RO_1 RO',
    ]);
  });
});
