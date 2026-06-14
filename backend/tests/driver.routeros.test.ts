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

  it('maps a Cisco trap level onto RouterOS log topics', () => {
    expect(ros.loggingTrap('warnings')).toEqual(['/system/logging/set [find action=switchpilot] topics=warning,error,critical']);
    expect(ros.loggingTrap('informational')).toEqual(['/system/logging/set [find action=switchpilot] topics=info,warning,error,critical']);
  });

  it('builds a baseline with discovery, remote logging, and SNMP v2c', () => {
    const plan = ros.baseline({ snmpVersion: '2c', snmpCommunity: 'mon-RO_1', platformHost: '192.168.10.226' });
    expect(plan.lines).toContain('/ip/neighbor/discovery-settings/set discover-interface-list=all');
    expect(plan.lines).toContain('/system/logging/action/add name=switchpilot target=remote remote=192.168.10.226 remote-port=514');
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

  it('refuses VLAN/mode port config and cable test rather than emit unverified commands', () => {
    expect(() => ros.portConfig('ether1', { mode: 'access', vlan: 20 })).toThrow(/not yet supported/i);
    expect(() => ros.cableTest('ether1')).toThrow(/not yet supported/i);
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
