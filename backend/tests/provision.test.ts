import { describe, it, expect } from 'vitest';
import { planFromInputs } from '../src/services/provisionService.js';
import { parseOuiCsv } from '../src/services/ouiService.js';

describe('planFromInputs', () => {
  it('always includes lldp run', () => {
    const plan = planFromInputs({});
    expect(plan.lines).toContain('lldp run');
  });

  it('adds syslog forwarding when PLATFORM_URL is set, hostname only', () => {
    const plan = planFromInputs({ platformUrl: 'http://192.168.1.10:8080' });
    expect(plan.lines).toContain('logging host 192.168.1.10');   // port deliberately dropped
    expect(plan.lines).toContain('logging trap informational');
  });

  it('skips syslog with a note when PLATFORM_URL is missing', () => {
    const plan = planFromInputs({});
    expect(plan.lines.some(l => l.startsWith('logging host'))).toBe(false);
    expect(plan.notes.some(n => n.includes('PLATFORM_URL not set'))).toBe(true);
  });

  it('adds the SNMP community for v2c credentials', () => {
    const plan = planFromInputs({ snmpVersion: '2c', snmpCommunity: 'mon-RO_1' });
    expect(plan.lines).toContain('snmp-server community mon-RO_1 RO');
  });

  it('rejects communities with config-line metacharacters', () => {
    const plan = planFromInputs({
      snmpVersion: '2c',
      snmpCommunity: 'public; username evil privilege 15 secret 0 hacked'
    });
    expect(plan.lines.some(l => l.startsWith('snmp-server'))).toBe(false);
    expect(plan.notes.some(n => n.includes('unsafe'))).toBe(true);
  });

  it('does not push communities for SNMPv3 profiles', () => {
    const plan = planFromInputs({ snmpVersion: '3', snmpCommunity: 'ignored' });
    expect(plan.lines.some(l => l.startsWith('snmp-server community'))).toBe(false);
    expect(plan.notes.some(n => n.includes('SNMPv3'))).toBe(true);
  });

  it('skips SNMP entirely when no community is stored', () => {
    const plan = planFromInputs({ snmpVersion: '2c', snmpCommunity: '' });
    expect(plan.lines.some(l => l.startsWith('snmp-server'))).toBe(false);
  });
});

describe('parseOuiCsv', () => {
  const csv = [
    'Registry,Assignment,Organization Name,Organization Address',
    'MA-L,286FB9,"Nokia Shanghai Bell Co., Ltd.","No.388 Ning Qiao Road Shanghai CN 201206"',
    'MA-L,B827EB,Raspberry Pi Foundation,"Mount Pleasant House Cambridge GB CB3 0RN"',
    'MA-S,70B3D5,Some Small Block,"ignored - not MA-L"',
    'MA-L,ZZZZZZ,Bad Hex,"ignored"',
    ''
  ].join('\n');

  it('parses quoted and unquoted organization names', () => {
    const entries = parseOuiCsv(csv);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({ oui: '286FB9', vendor: 'Nokia Shanghai Bell Co., Ltd.' });
    expect(entries[1]).toEqual({ oui: 'B827EB', vendor: 'Raspberry Pi Foundation' });
  });

  it('ignores non-MA-L registries and invalid hex', () => {
    const entries = parseOuiCsv(csv);
    expect(entries.find(e => e.oui === '70B3D5')).toBeUndefined();
  });

  it('uppercases the OUI', () => {
    const entries = parseOuiCsv('MA-L,aabbcc,Lower Hex Vendor,"addr"');
    expect(entries[0].oui).toBe('AABBCC');
  });
});
