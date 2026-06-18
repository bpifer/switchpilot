import { describe, it, expect } from 'vitest';
import { classifyConfigLines } from '../src/services/configPreview.js';

// A small running config: one trunk uplink (Gi0/0), one access port (Gi0/1),
// and the management SVI (Vlan99 holds the mgmt IP).
const RUNNING = `hostname sw1
!
interface GigabitEthernet0/0
 description Uplink
 switchport mode trunk
 switchport trunk allowed vlan 10,20,30
!
interface GigabitEthernet0/1
 description Printer
 switchport mode access
 switchport access vlan 10
!
interface Vlan99
 ip address 10.0.99.10 255.255.255.0
!`;
const MGMT_IP = '10.0.99.10';

describe('classifyConfigLines', () => {
  it('classifies a structured access-port edit (the Ports-tab case)', () => {
    const p = classifyConfigLines([
      'interface GigabitEthernet0/1',
      'switchport mode access',     // already present
      'switchport access vlan 20',  // changing 10 -> 20
      'description Lab-PC',          // changing the description
    ], RUNNING, MGMT_IP);

    const byLine = Object.fromEntries(p.lines.map(l => [l.line, l.status]));
    expect(byLine['interface GigabitEthernet0/1']).toBe('context');
    expect(byLine['switchport mode access']).toBe('present');
    expect(byLine['switchport access vlan 20']).toBe('new');
    expect(byLine['description Lab-PC']).toBe('new');
    expect(p.summary).toEqual({ new: 2, present: 1, removes: 0 });
    expect(p.warnings).toEqual([]);   // an access edit is not risky
  });

  it('distinguishes removes from no-ops', () => {
    const p = classifyConfigLines([
      'interface GigabitEthernet0/1',
      'no switchport access vlan 10',   // present -> removes
      'no switchport access vlan 999',  // absent  -> no-op
    ], RUNNING, MGMT_IP);
    const byLine = Object.fromEntries(p.lines.map(l => [l.line, l.status]));
    expect(byLine['no switchport access vlan 10']).toBe('removes');
    expect(byLine['no switchport access vlan 999']).toBe('no-op');
    expect(p.summary.removes).toBe(1);
  });

  it('warns when a trunk allowed-vlan edit REPLACES the list', () => {
    const p = classifyConfigLines(
      ['interface GigabitEthernet0/0', 'switchport trunk allowed vlan 10,20'], RUNNING, MGMT_IP);
    expect(p.warnings.some(w => /REPLACES the allowed VLAN list/.test(w))).toBe(true);
  });

  it('does NOT warn for an additive trunk allowed-vlan edit', () => {
    const p = classifyConfigLines(
      ['interface GigabitEthernet0/0', 'switchport trunk allowed vlan add 40'], RUNNING, MGMT_IP);
    expect(p.warnings).toEqual([]);
  });

  it('warns about shutting down or unaddressing the management interface', () => {
    expect(classifyConfigLines(['interface Vlan99', 'shutdown'], RUNNING, MGMT_IP)
      .warnings.some(w => /management interface/.test(w))).toBe(true);
    expect(classifyConfigLines(['interface Vlan99', 'no ip address'], RUNNING, MGMT_IP)
      .warnings.some(w => /lose access/.test(w))).toBe(true);
  });

  it('warns about shutting down a trunk/uplink', () => {
    const p = classifyConfigLines(['interface GigabitEthernet0/0', 'shutdown'], RUNNING, MGMT_IP);
    expect(p.warnings.some(w => /trunk\/uplink/.test(w))).toBe(true);
  });

  it('warns about deleting a VLAN or removing a login account', () => {
    expect(classifyConfigLines(['no vlan 10'], RUNNING, MGMT_IP)
      .warnings.some(w => /Deleting VLAN 10/.test(w))).toBe(true);
    expect(classifyConfigLines(['no username admin'], RUNNING, MGMT_IP)
      .warnings.some(w => /removes a login account/.test(w))).toBe(true);
  });
});
