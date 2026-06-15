import { describe, it, expect } from 'vitest';
import { ciscoDriver } from '../src/drivers/cisco.js';
import { driverFor } from '../src/drivers/index.js';

describe('ciscoDriver', () => {
  const ios = ciscoDriver('ios');
  const nx = ciscoDriver('nxos');

  it('save command and enable behavior differ for NX-OS', () => {
    expect(ios.saveCommand).toBe('write memory');
    expect(ios.skipEnable).toBe(false);
    expect(nx.saveCommand).toBe('copy running-config startup-config');
    expect(nx.skipEnable).toBe(true);
  });

  it('port admin expands the interface name', () => {
    expect(ios.setPortAdmin('Gi1/0/1', false)).toEqual(['interface GigabitEthernet1/0/1', 'shutdown']);
    expect(ios.setPortAdmin('Gi1/0/1', true)).toEqual(['interface GigabitEthernet1/0/1', 'no shutdown']);
  });

  it('access port config matches the previous inline output', () => {
    expect(ios.portConfig('Gi1/0/5', { mode: 'access', vlan: 20, voiceVlan: 100, description: 'printer' }))
      .toEqual([
        'interface GigabitEthernet1/0/5',
        'description printer',
        'switchport mode access',
        'switchport access vlan 20',
        'switchport voice vlan 100'
      ]);
  });

  it('trunk + STP + link + poe config matches the previous inline output', () => {
    expect(ios.portConfig('Gi1/0/1', {
      mode: 'trunk', trunkNativeVlan: 1, trunkAllowedVlans: '10,20',
      speed: '1000', duplex: 'full', portfast: true, bpduGuard: true, poeEnabled: false
    })).toEqual([
      'interface GigabitEthernet1/0/1',
      'switchport mode trunk',
      'switchport trunk native vlan 1',
      'switchport trunk allowed vlan 10,20',
      'speed 1000',
      'duplex full',
      'spanning-tree portfast',
      'spanning-tree bpduguard enable',
      'power inline never'
    ]);
  });

  it('strips newlines from a description so it cannot inject extra IOS commands', () => {
    const lines = ios.portConfig('Gi1/0/1', { description: 'lobby AP\nexit\nusername evil privilege 15 secret p' });
    expect(lines).toEqual([
      'interface GigabitEthernet1/0/1',
      'description lobby AP exit username evil privilege 15 secret p',
    ]);
    expect(lines.some(l => /[\r\n]/.test(l))).toBe(false);
  });

  it('empty description clears it; vlan without mode still sets access vlan', () => {
    expect(ios.portConfig('Gi1/0/2', { description: '' })).toEqual([
      'interface GigabitEthernet1/0/2', 'no description'
    ]);
    expect(ios.portConfig('Gi1/0/2', { vlan: 30 })).toEqual([
      'interface GigabitEthernet1/0/2', 'switchport access vlan 30'
    ]);
  });

  it('bounce, cable test, and logging trap match previous commands', () => {
    expect(ios.bounceLines('Gi1/0/8')).toEqual({
      down: ['interface GigabitEthernet1/0/8', 'shutdown'],
      up: ['interface GigabitEthernet1/0/8', 'no shutdown']
    });
    expect(ios.cableTest('Gi1/0/8')).toEqual({
      run: 'test cable-diagnostics tdr interface GigabitEthernet1/0/8',
      show: 'show cable-diagnostics tdr interface GigabitEthernet1/0/8'
    });
    expect(ios.loggingTrap('informational')).toEqual(['logging trap informational']);
  });

  it('poe cycle powers the port off then back on', () => {
    expect(ios.poeCycleLines('Gi1/0/5')).toEqual({
      off: ['interface GigabitEthernet1/0/5', 'power inline never'],
      on: ['interface GigabitEthernet1/0/5', 'power inline auto'],
    });
  });
});

describe('driverFor', () => {
  it('resolves os from capabilities, defaulting to ios/cisco', () => {
    expect(driverFor({ capabilities: { os: 'nxos' } }).saveCommand).toBe('copy running-config startup-config');
    expect(driverFor({}).vendor).toBe('cisco');
    expect(driverFor({}).os).toBe('ios');
  });
});
