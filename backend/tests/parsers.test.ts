import { describe, it, expect } from 'vitest';
import {
  parseShowVersion, parseInterfacesStatus, parseMacTable, parseCdpNeighborsDetail,
  parseCpu, parseMemory, parseEnvironment, parsePowerInline, parseShowSwitch,
  parseVlanBrief, expandInterfaceName
} from '../src/cisco/parsers.js';

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
});

describe('expandInterfaceName', () => {
  it('expands short names', () => {
    expect(expandInterfaceName('Gi1/0/1')).toBe('GigabitEthernet1/0/1');
    expect(expandInterfaceName('Te1/1/1')).toBe('TenGigabitEthernet1/1/1');
    expect(expandInterfaceName('Po1')).toBe('Port-channel1');
  });
});
