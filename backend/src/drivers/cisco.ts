// Cisco IOS / IOS-XE / NX-OS driver. Extracted verbatim from the inline
// command strings that used to live in deviceComms, the ports route, and the
// configs route - behavior is unchanged.
import { expandInterfaceName } from '../cisco/parsers.js';
import type { DeviceDriver, PortConfigOpts, BaselineOpts, BaselinePlan, DeviceToolId, DeviceToolOpts, FlowExportOpts } from './types.js';
import { assertToolTarget } from './types.js';

export function ciscoDriver(os: string): DeviceDriver {
  const nxos = os === 'nxos';
  return {
    vendor: 'cisco',
    os,
    // NX-OS SSH lands at privilege 15; enable() would be a no-op or error.
    skipEnable: nxos,
    saveCommand: nxos ? 'copy running-config startup-config' : 'write memory',
    configCommand: 'show running-config',

    baseline(o: BaselineOpts): BaselinePlan {
      // lldp run: discover non-Cisco neighbors (CDP only sees Cisco). Feeds
      // Topology, the Neighbors tab, and Discovery suggestions.
      const lines: string[] = ['lldp run'];
      const notes: string[] = ['lldp run: discover non-Cisco neighbors (UniFi, servers, APs)'];

      if (o.platformHost) {
        lines.push(`logging host ${o.platformHost}`, 'logging trap informational');
        notes.push(`syslog forwarding to ${o.platformHost} (UDP 514): real-time link/config/errdisable alerts`);
      } else {
        notes.push('PLATFORM_URL not set - skipped syslog forwarding');
      }

      if (o.snmpVersion && o.snmpVersion !== '3') {
        const community = o.snmpCommunity ?? '';
        if (community) {
          // Interpolated into an IOS config line - restrict to a safe charset
          // so a malformed stored value can't smuggle extra commands.
          if (/^[\w.\-]+$/.test(community)) {
            lines.push(`snmp-server community ${community} RO`);
            notes.push('SNMP v2c read-only community: fast status polling without SSH');
          } else {
            notes.push('SNMP community contains characters unsafe for a config line - skipped (use letters, digits, . _ -)');
          }
        }
      } else if (o.snmpVersion === '3') {
        notes.push('credential profile uses SNMPv3 - configure snmp-server user/group manually');
      }

      return { lines, notes };
    },

    setPortAdmin(port, enabled) {
      return [`interface ${expandInterfaceName(port)}`, enabled ? 'no shutdown' : 'shutdown'];
    },

    portConfig(port, o: PortConfigOpts) {
      const lines = [`interface ${expandInterfaceName(port)}`];
      if (o.description !== undefined) {
        // Strip CR/LF so a description can't inject extra IOS commands.
        const d = o.description.replace(/[\r\n]+/g, ' ').trim();
        lines.push(d ? `description ${d}` : 'no description');
      }
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

    portReadbackCommand(port) {
      return `show running-config interface ${expandInterfaceName(port)}`;
    },

    bounceLines(port) {
      const iface = expandInterfaceName(port);
      return { down: [`interface ${iface}`, 'shutdown'], up: [`interface ${iface}`, 'no shutdown'] };
    },

    poeCycleLines(port) {
      const iface = expandInterfaceName(port);
      return {
        off: [`interface ${iface}`, 'power inline never'],
        on: [`interface ${iface}`, 'power inline auto'],
      };
    },

    cableTest(port) {
      const iface = expandInterfaceName(port);
      return {
        run: `test cable-diagnostics tdr interface ${iface}`,
        show: `show cable-diagnostics tdr interface ${iface}`
      };
    },

    tools: ['ping', 'traceroute'],

    toolCommand(tool: DeviceToolId, { target, count }: DeviceToolOpts): string {
      assertToolTarget(target);
      switch (tool) {
        // `repeat` bounds ping; IOS traceroute self-terminates (max 30 hops).
        case 'ping':       return `ping ${target} repeat ${count}`;
        case 'traceroute': return `traceroute ${target}`;
        default:
          throw Object.assign(new Error(`${tool} is not supported on Cisco`), { statusCode: 501 });
      }
    },

    flowExportLines(_opts: FlowExportOpts): string[] {
      // Flexible NetFlow needs a flow record + exporter + monitor plus the
      // monitor applied per-interface (interface enumeration), and it is not yet
      // hardware-validated. Tracked in TODO (NetFlow follow-ups).
      throw Object.assign(new Error('NetFlow auto-export is not yet supported on Cisco'), { statusCode: 501 });
    },

    loggingTrap(level) {
      return [`logging trap ${level}`];
    }
  };
}
