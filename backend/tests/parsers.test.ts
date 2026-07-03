import { describe, it, expect } from 'vitest';
import {
  parseShowVersion, parseInterfacesStatus, parseMacTable, parseCdpNeighborsDetail,
  parseCpu, parseMemory, parseEnvironment, parsePowerInline, parseShowSwitch,
  parseVlanBrief, expandInterfaceName
} from '../src/cisco/parsers.js';
import { parseLldpNeighborsDetail } from '../src/cisco/parsers.js';
import { familyForModel } from '../src/cisco/capabilities.js';
import {
  SHOW_VERSION_IOSV_L2, SHOW_VERSION_IOL_XE, SHOW_INTERFACES_STATUS_IOSV,
  SHOW_VLAN_BRIEF_IOSV, SHOW_PROCESSES_CPU_IOSV, SHOW_PROCESSES_MEMORY_IOSV,
  SHOW_CDP_DETAIL_IOSV, SHOW_LLDP_DETAIL_IOSV
} from './fixtures/cisco.js';

describe('parseShowVersion', () => {
  it('parses Catalyst 2960X IOS output', () => {
    const out = `
Cisco IOS Software, C2960X Software (C2960X-UNIVERSALK9-M), Version 15.2(7)E3, RELEASE SOFTWARE (fc3)
...
SW-IDF2-01 uptime is 2 years, 31 weeks, 4 days, 7 hours, 26 minutes
System returned to ROM by power-on
...
cisco WS-C2960X-48FPD-L (APM86XXX) processor (revision A0) with 524288K bytes of memory.
Processor board ID FOC1234X0AB
...
Model number                    : WS-C2960X-48FPD-L
System serial number            : FOC1234X0AB
`;
    const v = parseShowVersion(out);
    expect(v.hostname).toBe('SW-IDF2-01');
    expect(v.model).toBe('WS-C2960X-48FPD-L');
    expect(v.serial).toBe('FOC1234X0AB');
    expect(v.iosVersion).toBe('15.2(7)E3');
    expect(v.uptimeSeconds).toBeGreaterThan(2 * 31536000);
  });

  it('parses Catalyst 9300 IOS-XE output', () => {
    const out = `
Cisco IOS XE Software, Version 17.09.04a
Cisco IOS Software [Cupertino], Catalyst L3 Switch Software (CAT9K_IOSXE), Version 17.9.4a, RELEASE SOFTWARE (fc3)
...
CORE-A uptime is 12 weeks, 3 days, 1 hour, 5 minutes
...
Model Number                       : C9300-48P
System Serial Number               : FJC2345A0BC
`;
    const v = parseShowVersion(out);
    expect(v.hostname).toBe('CORE-A');
    expect(v.model).toBe('C9300-48P');
    expect(v.serial).toBe('FJC2345A0BC');
  });
});

describe('parseInterfacesStatus', () => {
  it('parses connected/notconnect/trunk rows', () => {
    const out = `
Port      Name               Status       Vlan       Duplex  Speed Type
Gi1/0/1   AP-Floor2          connected    20         a-full a-1000 10/100/1000BaseTX
Gi1/0/2                      notconnect   1            auto   auto 10/100/1000BaseTX
Gi1/0/3   Uplink to CORE     connected    trunk      a-full a-1000 10/100/1000BaseTX
Gi1/0/4   bad port           err-disabled 10           auto   auto 10/100/1000BaseTX
`;
    const rows = parseInterfacesStatus(out);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ name: 'Gi1/0/1', description: 'AP-Floor2', status: 'connected', vlan: '20' });
    expect(rows[1].status).toBe('notconnect');
    expect(rows[2].vlan).toBe('trunk');
    expect(rows[3].status).toBe('err-disabled');
  });

  it('handles \\r\\n line endings from SSH shell output', () => {
    const out = 'Port      Name               Status       Vlan       Duplex  Speed Type\r\n' +
      'Gi1/0/1   UPLINK             connected    trunk      a-full a-1000 10/100/1000BaseTX\r\n' +
      'Gi1/0/2                      notconnect   10           auto   auto 10/100/1000BaseTX\r\n';
    const rows = parseInterfacesStatus(out);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: 'Gi1/0/1', status: 'connected', vlan: 'trunk' });
    expect(rows[1]).toMatchObject({ name: 'Gi1/0/2', status: 'notconnect', vlan: '10' });
  });

  it('normalizes IOS-XE status variants to the standard set', () => {
    const out = `
Port      Name               Status       Vlan       Duplex  Speed Type
Te1/1/1                      sfpAbsent    1            full    10G SFP-10GBase-SR
Te1/1/2                      sfpPresent   1            full    10G SFP-10GBase-SR
Gi0/0                        up           routed       full   1000 RJ45
Gi0/1                        down         routed       auto   auto RJ45
`;
    const rows = parseInterfacesStatus(out);
    expect(rows).toHaveLength(4);
    expect(rows[0].status).toBe('notconnect');  // sfpAbsent -> notconnect
    expect(rows[1].status).toBe('notconnect');  // sfpPresent (no link) -> notconnect
    expect(rows[2].status).toBe('connected');   // up -> connected
    expect(rows[3].status).toBe('notconnect');  // down -> notconnect
  });
});

describe('parseMacTable', () => {
  it('parses dynamic entries', () => {
    const out = `
          Mac Address Table
-------------------------------------------
Vlan    Mac Address       Type        Ports
----    -----------       --------    -----
  20    0050.56ab.cdef    DYNAMIC     Gi1/0/1
  20    a0b1.c2d3.e4f5    DYNAMIC     Gi1/0/1
   1    000c.2912.3456    STATIC      CPU
`;
    const macs = parseMacTable(out);
    expect(macs).toHaveLength(3); // includes the STATIC/CPU row; callers filter on type
    expect(macs[0]).toMatchObject({ vlan: 20, mac: '0050.56ab.cdef', port: 'Gi1/0/1', type: 'DYNAMIC' });
    expect(macs[2].type).toBe('STATIC');
  });
});

describe('parseCdpNeighborsDetail', () => {
  it('extracts neighbor identity and ports', () => {
    const out = `
-------------------------
Device ID: CORE-A.corp.local
Entry address(es):
  IP address: 10.0.0.1
Platform: cisco C9300-48P,  Capabilities: Router Switch IGMP
Interface: GigabitEthernet1/0/48,  Port ID (outgoing port): TenGigabitEthernet1/1/1
Holdtime : 132 sec
`;
    const n = parseCdpNeighborsDetail(out);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({
      neighborName: 'CORE-A',
      neighborIp: '10.0.0.1',
      platform: 'C9300-48P',
      localPort: 'GigabitEthernet1/0/48',
      neighborPort: 'TenGigabitEthernet1/1/1'
    });
  });
});

describe('health parsers', () => {
  it('parses CPU utilization', () => {
    const cpu = parseCpu('CPU utilization for five seconds: 7%/0%; one minute: 9%; five minutes: 8%');
    expect(cpu).toEqual({ fiveSec: 7, oneMin: 9, fiveMin: 8 });
  });

  it('parses processor memory', () => {
    const pct = parseMemory('Processor Pool Total:  447614436 Used:  144078904 Free:  303535532');
    expect(pct).toBeCloseTo(32.2, 0);
  });

  it('parses env PSU/fan/temp', () => {
    const env = parseEnvironment(`
FAN 1 is OK
FAN 2 is OK
TEMPERATURE is OK
Temperature Value: 33 Degree Celsius
POWER SUPPLY 1 is OK
POWER SUPPLY 2 is Not Present
`);
    expect(env.temperatureC).toBe(33);
    expect(env.psu).toHaveLength(2);
    expect(env.fans.filter(f => f.status === 'OK')).toHaveLength(2);
  });

  // Real `show environment all` from a live C9300-24T (IOS-XE 17.03.07) with a
  // single PSU: the chassis fan table + PSU-fan lines, one PSU present, second
  // slot empty. Regression: a bare \S+ status truncated "NOT PRESENT" to "NOT",
  // and the chassis fan table wasn't parsed at all.
  it('parses a real C9300 environment (chassis fan table + empty PSU slot)', () => {
    const env = parseEnvironment(`Switch   FAN   Speed   State
---------------------------------------------------
  1      1   13760     OK
  1      2   13760     OK
  1      3   13760     OK
FAN PS-1 is OK
FAN PS-2 is NOT PRESENT
Switch 1: SYSTEM TEMPERATURE is OK
Inlet Temperature Value: 26 Degree Celsius
Temperature State: GREEN
Yellow Threshold : 46 Degree Celsius
Red Threshold    : 56 Degree Celsius
SW  PID                 Serial#     Status           Sys Pwr  PoE Pwr  Watts
--  ------------------  ----------  ---------------  -------  -------  -----
1A  PWR-C1-350WAC-P     DCC2310B3M0  OK              Good     n/a      350
1B  Not Present`);

    expect(env.temperatureC).toBe(26);
    // one PSU present and OK (the empty 1B slot is not reported as a supply)
    expect(env.psu).toEqual([{ id: '1A', status: 'OK' }]);
    // 3 chassis fans + 2 PSU fans, all captured with FULL status
    expect(env.fans).toHaveLength(5);
    expect(env.fans.filter(f => f.status === 'OK')).toHaveLength(4);
    const psFan = env.fans.find(f => f.id === 'PS-2');
    expect(psFan?.status).toBe('NOT PRESENT');   // not truncated to "NOT"
  });

  it('parses power inline', () => {
    const poe = parsePowerInline(`
Interface Admin  Oper       Power   Device              Class Max
--------- ------ ---------- ------- ------------------- ----- ----
Gi1/0/1   auto   on         15.4    IP Phone 8841       3     30.0
Gi1/0/2   auto   off        0.0     n/a                 n/a   30.0
`);
    expect(poe[0]).toMatchObject({ port: 'Gi1/0/1', oper: 'on', watts: 15.4 });
  });

  it('parses show switch stack members', () => {
    const stack = parseShowSwitch(`
Switch/Stack Mac Address : 0011.2233.4455
                                           H/W   Current
Switch#  Role   Mac Address     Priority Version  State
------------------------------------------------------------
*1       Active 0011.2233.4455     15     V04     Ready
 2       Standby 0011.2233.4466    14     V04     Ready
 3       Member 0011.2233.4477      1     V04     Ready
`);
    expect(stack).toHaveLength(3);
    expect(stack[0]).toMatchObject({ member: 1, role: 'Active', state: 'Ready' });
  });
});

describe('parseVlanBrief', () => {
  it('parses vlan rows', () => {
    const vlans = parseVlanBrief(`
VLAN Name                             Status    Ports
---- -------------------------------- --------- -------------------------------
1    default                          active    Gi1/0/2, Gi1/0/5
20   USERS                            active    Gi1/0/1
99   MGMT                             active
`);
    expect(vlans).toHaveLength(3);
    expect(vlans[1]).toMatchObject({ id: 20, name: 'USERS' });
  });

  it('keeps every VLAN with \\r\\n output, wrapped port lists, and varied states', () => {
    const vlans = parseVlanBrief(
      'VLAN Name                             Status    Ports\r\n' +
      '---- -------------------------------- --------- ------\r\n' +
      '1    default                          active    Gi1/0/10, Gi1/0/11, Gi1/0/12,\r\n' +
      '                                                Gi1/0/13, Gi1/0/14\r\n' +
      '10   DATA                             active    Gi1/0/1, Gi1/0/2\r\n' +
      '20   VOICE                            active\r\n' +
      '30   MGMT                             act/lshut\r\n');
    expect(vlans.map(v => v.id)).toEqual([1, 10, 20, 30]);   // all four kept
    expect(vlans[0].ports).toContain('Gi1/0/14');             // wrapped port captured
    expect(vlans[0].ports.every(p => !p.includes('\r'))).toBe(true);
    expect(vlans[3]).toMatchObject({ id: 30, name: 'MGMT' }); // act/lshut state kept
  });

  it('parses real 2960X output (wrapped lists, \\r\\n) keeping all user VLANs', () => {
    const out = [
      'VLAN Name                             Status    Ports',
      '---- -------------------------------- --------- -------------------------------',
      '1    default                          active    Gi1/0/25, Gi1/0/26, Gi1/0/27',
      '                                                Gi1/0/28',
      '10   data                             active    Gi1/0/2, Gi1/0/4, Gi1/0/6',
      '                                                Gi1/0/7, Gi1/0/9, Gi1/0/10',
      '                                                Gi1/0/11, Gi1/0/12, Gi1/0/13',
      '20   iot                              active    Gi1/0/3',
      '30   home                             active    Gi1/0/8',
      '40   vpn                              active    Gi1/0/5',
      '1002 fddi-default                     act/unsup',
    ].join('\r\n') + '\r\n';
    const vlans = parseVlanBrief(out);
    expect(vlans.map(v => v.id)).toEqual([1, 10, 20, 30, 40, 1002]);  // endpoint filters 1002 later
    expect(vlans.find(v => v.id === 1)!.ports).toContain('Gi1/0/28');  // wrapped onto line 2
    expect(vlans.find(v => v.id === 10)!.ports).toContain('Gi1/0/13'); // wrapped onto line 3
    expect(vlans.find(v => v.id === 30)!.ports).toEqual(['Gi1/0/8']);
  });
});

describe('expandInterfaceName', () => {
  it('expands short names', () => {
    expect(expandInterfaceName('Gi1/0/1')).toBe('GigabitEthernet1/0/1');
    expect(expandInterfaceName('Te1/1/1')).toBe('TenGigabitEthernet1/1/1');
    expect(expandInterfaceName('Po1')).toBe('Port-channel1');
  });
});

// Regression coverage from REAL Cisco Modeling Labs (CML) virtual-switch output.
// These guard the IOS families the test bench exercises: classic IOS (iosvl2
// 15.2) and IOS-XE/IOL (ioll2-xe 17.18). See fixtures/cisco.ts for provenance.
describe('CML virtual switch captures', () => {
  it('parses IOSv-L2 15.2 show version (experimental version with a colon)', () => {
    const v = parseShowVersion(SHOW_VERSION_IOSV_L2);
    expect(v.hostname).toBe('IOS-L2-SW');
    expect(v.serial).toBe('9K70VA7Z9HT');
    // The colon-bearing build string must parse, not silently drop to ''.
    expect(v.iosVersion).toBe('15.2(20200924:215240)');
    // Virtual platforms emit no Catalyst model string -> model empty -> no family.
    expect(v.model).toBe('');
    expect(familyForModel(v.model)).toBeNull();
  });

  it('parses IOL-XE 17.18 show version banner', () => {
    const v = parseShowVersion(SHOW_VERSION_IOL_XE);
    expect(v.hostname).toBe('IOSXE-L2-SW');
    expect(v.iosVersion).toBe('17.18.2');
    expect(v.serial).toBe('2039811');
    expect(v.model).toBe('');
  });

  it('parses IOSv-L2 show interfaces status (RJ45 type, trunk + disabled rows)', () => {
    const rows = parseInterfacesStatus(SHOW_INTERFACES_STATUS_IOSV);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ name: 'Gi0/0', status: 'notconnect', vlan: 'trunk', type: 'RJ45' });
    expect(rows[3]).toMatchObject({ name: 'Gi0/3', status: 'disabled', vlan: '1' });
  });

  it('parses IOSv-L2 show vlan brief (default + reserved 100x VLANs)', () => {
    const vlans = parseVlanBrief(SHOW_VLAN_BRIEF_IOSV);
    expect(vlans.map(v => v.id)).toEqual([1, 10, 20, 1002, 1003, 1004, 1005]);
    expect(vlans.find(v => v.id === 1)!.ports).toEqual(['Gi0/0', 'Gi0/3']);
    expect(vlans.find(v => v.id === 10)!.ports).toEqual(['Gi0/1']);
  });

  it('parses IOSv-L2 cpu and memory', () => {
    expect(parseCpu(SHOW_PROCESSES_CPU_IOSV)).toEqual({ fiveSec: 99, oneMin: 41, fiveMin: 10 });
    expect(parseMemory(SHOW_PROCESSES_MEMORY_IOSV)).toBeCloseTo(10.3, 1);
  });

  it('parses real CDP detail (IP-less entry + "Linux Unix" platform)', () => {
    const n = parseCdpNeighborsDetail(SHOW_CDP_DETAIL_IOSV);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({
      neighborName: 'IOSXE-L2-SW',
      neighborIp: '',                       // CDP advertised no address here
      platform: 'Linux Unix',
      localPort: 'GigabitEthernet0/0',
      neighborPort: 'Ethernet0/0'
    });
  });

  it('parses real LLDP detail (mgmt IP, multi-line descr, lowercase "Port id")', () => {
    const n = parseLldpNeighborsDetail(SHOW_LLDP_DETAIL_IOSV);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({
      neighborName: 'IOSXE-L2-SW',
      neighborIp: '10.0.30.11',
      localPort: 'Gi0/0',
      neighborPort: 'Et0/0'
    });
    expect(n[0].platform).toContain('IOSXE');
  });
});
