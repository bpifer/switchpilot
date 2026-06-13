// Cisco IOS / IOS-XE / NX-OS driver. Extracted verbatim from the inline
// command strings that used to live in deviceComms, the ports route, and the
// configs route - behavior is unchanged.
import { expandInterfaceName } from '../cisco/parsers.js';
import type { DeviceDriver, PortConfigOpts } from './types.js';

export function ciscoDriver(os: string): DeviceDriver {
  const nxos = os === 'nxos';
  return {
    vendor: 'cisco',
    os,
    // NX-OS SSH lands at privilege 15; enable() would be a no-op or error.
    skipEnable: nxos,
    saveCommand: nxos ? 'copy running-config startup-config' : 'write memory',

    setPortAdmin(port, enabled) {
      return [`interface ${expandInterfaceName(port)}`, enabled ? 'no shutdown' : 'shutdown'];
    },

    portConfig(port, o: PortConfigOpts) {
      const lines = [`interface ${expandInterfaceName(port)}`];
      if (o.description !== undefined) lines.push(o.description ? `description ${o.description}` : 'no description');
      if (o.mode === 'access') {
        lines.push('switchport mode access');
        if (o.vlan) lines.push(`switchport access vlan ${o.vlan}`);
      } else if (o.mode === 'trunk') {
        lines.push('switchport mode trunk');
        if (o.trunkNativeVlan) lines.push(`switchport trunk native vlan ${o.trunkNativeVlan}`);
        if (o.trunkAllowedVlans) lines.push(`switchport trunk allowed vlan ${o.trunkAllowedVlans}`);
      } else if (o.vlan) {
        lines.push(`switchport access vlan ${o.vlan}`);
      }
      if (o.voiceVlan !== undefined) lines.push(`switchport voice vlan ${o.voiceVlan}`);
      if (o.speed) lines.push(`speed ${o.speed}`);
      if (o.duplex) lines.push(`duplex ${o.duplex}`);
      if (o.portfast !== undefined) lines.push(o.portfast ? 'spanning-tree portfast' : 'no spanning-tree portfast');
      if (o.bpduGuard !== undefined) lines.push(o.bpduGuard ? 'spanning-tree bpduguard enable' : 'spanning-tree bpduguard disable');
      if (o.poeEnabled !== undefined) lines.push(o.poeEnabled ? 'power inline auto' : 'power inline never');
      return lines;
    },

    bounceLines(port) {
      const iface = expandInterfaceName(port);
      return { down: [`interface ${iface}`, 'shutdown'], up: [`interface ${iface}`, 'no shutdown'] };
    },

    cableTest(port) {
      const iface = expandInterfaceName(port);
      return {
        run: `test cable-diagnostics tdr interface ${iface}`,
        show: `show cable-diagnostics tdr interface ${iface}`
      };
    },

    loggingTrap(level) {
      return [`logging trap ${level}`];
    }
  };
}
