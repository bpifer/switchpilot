import { describe, it, expect } from 'vitest';
import { parseTrap, classifyTrap } from '../src/services/snmpTrapService.js';

const TRAP_OID = '1.3.6.1.6.3.1.1.4.1.0';

// A v2 trap always leads with sysUpTime.0 + snmpTrapOID.0, then trap-specific varbinds.
function v2(trapOid: string, extra: { oid: string; value: unknown }[] = []) {
  return { varbinds: [
    { oid: '1.3.6.1.2.1.1.3.0', value: 12345 },
    { oid: TRAP_OID, value: trapOid },
    ...extra,
  ] };
}

describe('parseTrap', () => {
  it('extracts the trap OID and interface varbinds from a v2 linkDown', () => {
    const p = parseTrap(v2('1.3.6.1.6.3.1.1.5.3', [
      { oid: '1.3.6.1.2.1.2.2.1.1.5', value: 5 },
      { oid: '1.3.6.1.2.1.2.2.1.2.5', value: Buffer.from('GigabitEthernet1/0/5') },
    ]));
    expect(p).toEqual({ trapOid: '1.3.6.1.6.3.1.1.5.3', ifIndex: '5', ifDescr: 'GigabitEthernet1/0/5' });
  });

  it('falls back to the SNMPv1 generic-trap code when there is no snmpTrapOID', () => {
    // generic 2 == linkDown -> 1.3.6.1.6.3.1.1.5.3
    const p = parseTrap({ generic: 2, varbinds: [{ oid: '1.3.6.1.2.1.2.2.1.1.3', value: 3 }] });
    expect(p).toEqual({ trapOid: '1.3.6.1.6.3.1.1.5.3', ifIndex: '3' });
  });
});

describe('classifyTrap', () => {
  it('raises a per-ifIndex link_down on linkDown', () => {
    expect(classifyTrap({ trapOid: '1.3.6.1.6.3.1.1.5.3', ifIndex: '5', ifDescr: 'Gi1/0/5' }))
      .toMatchObject({ action: 'raise', kind: 'link_down:5', severity: 'warning' });
  });

  it('resolves the matching link_down on linkUp', () => {
    expect(classifyTrap({ trapOid: '1.3.6.1.6.3.1.1.5.4', ifIndex: '5' }))
      .toEqual({ action: 'resolve', kind: 'link_down:5' });
  });

  it('raises device_reboot on coldStart and snmp_auth_failure on authenticationFailure', () => {
    expect(classifyTrap({ trapOid: '1.3.6.1.6.3.1.1.5.1' })).toMatchObject({ action: 'raise', kind: 'device_reboot', severity: 'warning' });
    expect(classifyTrap({ trapOid: '1.3.6.1.6.3.1.1.5.5' })).toMatchObject({ action: 'raise', kind: 'snmp_auth_failure' });
  });

  it('ignores unknown traps', () => {
    expect(classifyTrap({ trapOid: '1.3.6.1.4.1.9.9.999.0.1' })).toBeNull();
    expect(classifyTrap({})).toBeNull();
  });

  it('end-to-end: a v2 linkUp PDU resolves the right port alert', () => {
    expect(classifyTrap(parseTrap(v2('1.3.6.1.6.3.1.1.5.4', [{ oid: '1.3.6.1.2.1.2.2.1.1.8', value: 8 }]))))
      .toEqual({ action: 'resolve', kind: 'link_down:8' });
  });
});
