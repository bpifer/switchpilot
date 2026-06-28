import { describe, it, expect } from 'vitest';
import { ciscoDriver } from '../src/drivers/cisco.js';
import { routerosDriver } from '../src/drivers/routeros.js';
import { assertToolTarget } from '../src/drivers/types.js';

describe('device tools - command building', () => {
  const cisco = ciscoDriver('ios');
  const ros = routerosDriver();

  it('advertises the tools each vendor supports', () => {
    expect(cisco.tools).toEqual(['ping', 'traceroute']);
    expect(ros.tools).toEqual(['ping', 'traceroute', 'ip-scan']);
  });

  it('builds bounded Cisco ping/traceroute', () => {
    expect(cisco.toolCommand('ping', { target: '8.8.8.8', count: 5 })).toBe('ping 8.8.8.8 repeat 5');
    expect(cisco.toolCommand('traceroute', { target: 'host.example.com', count: 5 })).toBe('traceroute host.example.com');
  });

  it('builds bounded RouterOS ping/traceroute/ip-scan', () => {
    expect(ros.toolCommand('ping', { target: '1.1.1.1', count: 4 })).toBe('/ping 1.1.1.1 count=4');
    expect(ros.toolCommand('traceroute', { target: '1.1.1.1', count: 5 })).toBe('/tool traceroute 1.1.1.1');
    expect(ros.toolCommand('ip-scan', { target: '192.168.10.0/24', count: 5 }))
      .toBe('/tool ip-scan address-range=192.168.10.0/24 duration=5');
  });

  it('refuses a tool the vendor does not support (501)', () => {
    expect(() => cisco.toolCommand('ip-scan', { target: '192.168.0.0/24', count: 5 }))
      .toThrow(/not supported on Cisco/i);
  });
});

describe('device tools - target validation (injection guard)', () => {
  it('accepts IPs, hostnames, and IPv4 CIDR', () => {
    for (const t of ['8.8.8.8', '192.168.1.0/24', 'host.example.com', '2001:db8::1', 'a-b_c.local']) {
      expect(() => assertToolTarget(t)).not.toThrow();
    }
  });

  it('rejects whitespace and CLI metacharacters', () => {
    for (const t of ['8.8.8.8; /system reset', '8.8.8.8 && reboot', 'a|b', '$(x)', '[find]', 'a b', '"x"', "a'b", '`x`']) {
      expect(() => assertToolTarget(t)).toThrow(/invalid tool target/i);
    }
  });

  it('toolCommand re-guards the target so a driver cannot be tricked directly', () => {
    expect(() => routerosDriver().toolCommand('ping', { target: '8.8.8.8 count=5; /user add', count: 5 }))
      .toThrow(/invalid tool target/i);
    expect(() => ciscoDriver('ios').toolCommand('ping', { target: '8.8.8.8\nreload', count: 5 }))
      .toThrow(/invalid tool target/i);
  });
});

describe('device tools - RouterOS output cleanup (validated against a CRS326)', () => {
  const ros = routerosDriver();

  // RouterOS re-prints the whole table each interval, so a bounded capture stacks
  // several frames. These fixtures are trimmed from real CRS326 7.12.1 output.
  it('collapses a refreshing traceroute to its most complete frame', () => {
    const raw = [
      'Columns: ADDRESS, LOSS, SENT, LAST, AVG, BEST, WORST, STD-DEV',
      '1  192.168.10.1  0%  1  0.4ms  0.4  0.4  0.4  0',
      '',
      'Columns: ADDRESS, LOSS, SENT, LAST, AVG, BEST, WORST, STD-DEV',
      '1  192.168.10.1  0%  2  0.2ms  0.3  0.2  0.4  0.1',
      '2  108.39.138.1  0%  2  0.8ms  1.9  0.8  3    1.1',
      '',
      'Columns: ADDRESS, LOSS, SENT, LAST, AVG, BEST, WORST, STD-DEV',
      '1  192.168.10.1     0%  3  0.2ms  0.3  0.2  0.4  0.1',
      '2  108.39.138.1     0%  3  0.8ms  1.5  0.8  3    1',
      '5  204.148.170.134  0%  2  9.3ms  9.4  9.3  9.4  0.1',
      '8  8.8.8.8          0%  2  10ms   10   10   10   0',
    ].join('\n');
    const out = ros.cleanToolOutput!('traceroute', raw);
    expect((out.match(/^Columns:/gm) || []).length).toBe(1);       // one frame, not three
    expect(out).toContain('8.8.8.8');                              // the final hop survived
    expect(out).toContain('204.148.170.134');
    expect(out.split('\n').filter(l => l.trim()).length).toBe(5);  // header + 4 hops
  });

  it('collapses a refreshing ip-scan to one frame', () => {
    const raw = [
      'Columns: ADDRESS, TIME', 'ADDRESS        TIME', '192.168.10.41  1ms', '',
      'Columns: ADDRESS, TIME', 'ADDRESS        TIME', '192.168.10.41  1ms',
    ].join('\n');
    const out = ros.cleanToolOutput!('ip-scan', raw);
    expect((out.match(/^Columns:/gm) || []).length).toBe(1);
    expect(out).toContain('192.168.10.41');
  });

  it('passes append-only ping output through untouched', () => {
    const raw = '  SEQ HOST          SIZE TTL TIME   STATUS\n    0 192.168.10.1  56  64  371us\n    sent=4 received=4 packet-loss=0%';
    expect(ros.cleanToolOutput!('ping', raw)).toBe(raw);
  });

  it('cisco has no streaming cleanup (its tools are append-only)', () => {
    expect(ciscoDriver('ios').cleanToolOutput).toBeUndefined();
  });
});

describe('NetFlow auto-export - config building', () => {
  it('RouterOS points traffic-flow at the collector idempotently (validated v7 syntax)', () => {
    expect(routerosDriver().flowExportLines({ host: '192.168.10.250', port: 2055 })).toEqual([
      '/ip traffic-flow target remove [find dst-address=192.168.10.250]',
      '/ip traffic-flow target add dst-address=192.168.10.250 port=2055 version=9',
      '/ip traffic-flow set enabled=yes interfaces=all',
    ]);
  });

  it('RouterOS re-guards the collector host against CLI metacharacters', () => {
    expect(() => routerosDriver().flowExportLines({ host: '1.2.3.4; /system reset', port: 2055 }))
      .toThrow(/invalid tool target/i);
  });

  it('Cisco flow-export is not yet supported (501)', () => {
    expect(() => ciscoDriver('ios').flowExportLines({ host: '10.0.0.1', port: 2055 }))
      .toThrow(/not yet supported on Cisco/i);
  });
});

describe('commit-confirm - revert line building', () => {
  const ros = routerosDriver();

  it('RouterOS arms a backup + scheduled restore (verified CRS326 7.12.1 syntax)', () => {
    expect(ros.supportsCommitConfirm).toBe(true);
    expect(ros.armRevertLines({ token: 'spcc123', seconds: 120 })).toEqual([
      '/file remove [find name~"spcc"]',
      '/system backup save name=spcc123 dont-encrypt=yes',
      '/system scheduler add name=spcc123 interval=120s on-event="/system backup load name=spcc123 password=\\"\\""',
    ]);
  });

  it('RouterOS disarm removes the scheduler and deletes the snapshot', () => {
    expect(ros.disarmRevertLines('spcc123')).toEqual([
      '/system scheduler remove [find name=spcc123]',
      '/file remove [find name~"spcc123"]',
    ]);
  });

  it('rejects a non-alphanumeric revert token (injection guard)', () => {
    expect(() => ros.armRevertLines({ token: 'x; /system reset', seconds: 60 })).toThrow(/invalid revert token/i);
    expect(() => ros.disarmRevertLines('a b')).toThrow(/invalid revert token/i);
  });

  it('Cisco does not support commit-confirm yet (501)', () => {
    const cisco = ciscoDriver('ios');
    expect(cisco.supportsCommitConfirm).toBe(false);
    expect(() => cisco.armRevertLines({ token: 'spcc123', seconds: 120 })).toThrow(/not yet supported on Cisco/i);
  });
});

describe('LAG / port-channel - config building', () => {
  it('RouterOS bond is bridge-aware (sequence validated on a CRS326)', () => {
    const [line] = routerosDriver().lagCreateLines({ id: 'bond1', members: ['ether1', 'ether2'], mode: 'lacp' });
    expect(line).toContain(':local br [/interface bridge port get [find interface=ether1] bridge]');
    expect(line).toContain('/interface bridge port remove [find interface=ether1]');
    expect(line).toContain('/interface bridge port remove [find interface=ether2]');
    expect(line).toContain('/interface bonding add name=bond1 slaves=ether1,ether2 mode=802.3ad');
    expect(line).toContain('/interface bridge port add bridge=$br interface=bond1');
  });

  it('RouterOS static bond uses balance-xor; delete restores slaves to the bridge', () => {
    expect(routerosDriver().lagCreateLines({ id: 'bond1', members: ['ether1', 'ether2'], mode: 'static' })[0])
      .toContain('mode=balance-xor');
    const [del] = routerosDriver().lagDeleteLines({ id: 'bond1', members: [], mode: 'lacp' });
    expect(del).toContain(':local sl [/interface bonding get [find name=bond1] slaves]');
    expect(del).toContain('/interface bonding remove [find name=bond1]');
    expect(del).toContain(':foreach s in=$sl do={ /interface bridge port add bridge=$br interface=$s }');
  });

  it('Cisco EtherChannel sets channel-group on each member (LACP active)', () => {
    const lines = ciscoDriver('ios').lagCreateLines({ id: '1', members: ['Gi1/0/1', 'Gi1/0/2'], mode: 'lacp' });
    expect(lines.filter(l => l === 'channel-group 1 mode active')).toHaveLength(2);
    expect(lines.filter(l => l.startsWith('interface '))).toHaveLength(2);
  });

  it('Cisco static uses mode on; delete removes the group + Port-channel', () => {
    expect(ciscoDriver('ios').lagCreateLines({ id: '2', members: ['Gi1/0/1', 'Gi1/0/2'], mode: 'static' }))
      .toContain('channel-group 2 mode on');
    const del = ciscoDriver('ios').lagDeleteLines({ id: '2', members: ['Gi1/0/1'], mode: 'static' });
    expect(del).toContain('no channel-group 2');
    expect(del).toContain('no interface Port-channel 2');
  });

  it('rejects a LAG with fewer than 2 members and a non-numeric Cisco id', () => {
    expect(() => routerosDriver().lagCreateLines({ id: 'bond1', members: ['ether1'], mode: 'lacp' })).toThrow(/at least 2/i);
    expect(() => ciscoDriver('ios').lagCreateLines({ id: 'x', members: ['Gi1/0/1', 'Gi1/0/2'], mode: 'lacp' })).toThrow(/must be a number/i);
  });
});
