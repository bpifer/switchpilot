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
