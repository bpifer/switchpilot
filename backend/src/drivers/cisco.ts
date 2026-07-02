// Cisco IOS / IOS-XE / NX-OS driver. Extracted verbatim from the inline
// command strings that used to live in deviceComms, the ports route, and the
// configs route - behavior is unchanged.
import { expandInterfaceName, assertCiscoPort } from '../cisco/parsers.js';
import type { DeviceDriver, PortConfigOpts, BaselineOpts, BaselinePlan, DeviceToolId, DeviceToolOpts, FlowExportOpts, RevertGuardOpts, LagOpts } from './types.js';
import { assertToolTarget } from './types.js';

/** Cisco channel-group / Port-channel id is a small integer. */
function assertChannelId(id: string): void {
  if (!/^\d{1,4}$/.test(id)) {
    throw Object.assign(new Error('Cisco channel-group id must be a number (1-4096)'), { statusCode: 400 });
  }
}

/** Validate an interface name (injection guard) then expand its abbreviation,
 *  for every place a port name reaches a CLI command. */
function ciscoIface(name: string): string {
  assertCiscoPort(name);
  return expandInterfaceName(name);
}

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
      return [`interface ${ciscoIface(port)}`, enabled ? 'no shutdown' : 'shutdown'];
    },

    portConfig(port, o: PortConfigOpts) {
      const lines = [`interface ${ciscoIface(port)}`];
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
      return `show running-config interface ${ciscoIface(port)}`;
    },

    bounceLines(port) {
      const iface = ciscoIface(port);
      return { down: [`interface ${iface}`, 'shutdown'], up: [`interface ${iface}`, 'no shutdown'] };
    },

    poeCycleLines(port) {
      const iface = ciscoIface(port);
      return {
        off: [`interface ${iface}`, 'power inline never'],
        on: [`interface ${iface}`, 'power inline auto'],
      };
    },

    cableTest(port) {
      const iface = ciscoIface(port);
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

    flowExportLines({ host, port, interfaces }: FlowExportOpts): string[] {
      // Flexible NetFlow: flow record + exporter + monitor, then the monitor
      // attached input-side on each physical Ethernet port (FNF has no global
      // "all interfaces" switch like RouterOS traffic-flow). The record's field
      // set is exactly what the platform's v9 decoder extracts: src/dst IPv4,
      // L4 ports, protocol, byte/packet counters. Validated on a C9300-24T
      // (IOS-XE 17.03.07): every line accepted (zero % messages), monitor
      // attaches on L2 switchports, and re-applying the identical config is a
      // clean no-op - 17.3 re-accepts identical record fields without even an
      // "in use" warning. (Collector delivery e2e still needs a live platform.)
      if (nxos) {
        // NX-OS needs `feature netflow` and has its own record grammar.
        throw Object.assign(new Error('NetFlow auto-export is not yet supported on NX-OS'), { statusCode: 501 });
      }
      assertToolTarget(host);   // host reaches the CLI; reuse the metachar guard
      const physical = (interfaces ?? [])
        .filter(p => /^[A-Za-z0-9./-]{1,48}$/.test(p))   // skip malformed rows rather than abort
        .map(p => ciscoIface(p))
        // Physical Ethernet only: no Port-channels (FNF monitors attach to the
        // members, which this list already includes), VLANs, or subinterfaces.
        .filter(name => /^(FastEthernet|GigabitEthernet|TwoGigabitEthernet|TenGigabitEthernet|FortyGigabitEthernet|HundredGigE)[\d/]+$/.test(name));
      if (!physical.length) {
        throw Object.assign(new Error(
          'No physical Ethernet ports are known for this device yet, so the flow monitor cannot be attached. Refresh the device first.'),
          { statusCode: 400 });
      }
      return [
        'flow record SWITCHPILOT',
        'match ipv4 protocol',
        'match ipv4 source address',
        'match ipv4 destination address',
        'match transport source-port',
        'match transport destination-port',
        'collect counter bytes long',
        'collect counter packets long',
        'collect timestamp absolute first',
        'collect timestamp absolute last',
        'flow exporter SWITCHPILOT',
        `destination ${host}`,
        `transport udp ${port}`,
        'export-protocol netflow-v9',
        'template data timeout 60',
        'flow monitor SWITCHPILOT',
        'exporter SWITCHPILOT',
        'record SWITCHPILOT',
        'cache timeout active 60',
        'cache timeout inactive 15',
        ...physical.flatMap(name => [`interface ${name}`, 'ip flow monitor SWITCHPILOT input']),
      ];
    },

    supportsCommitConfirm: true,
    probeCommand: 'show clock',

    armRevertLines(_opts: RevertGuardOpts): string[] {
      // Cisco commit-confirm is handled at the session level via
      // CiscoSshSession.armRevert() (interactive `reload in N` prompts).
      // This driver method is intentionally unused on Cisco.
      throw Object.assign(new Error('Cisco commit-confirm is handled at the session level, not via config lines'), { statusCode: 501 });
    },

    disarmRevertLines(_token: string): string[] {
      throw Object.assign(new Error('Cisco commit-confirm is handled at the session level, not via config lines'), { statusCode: 501 });
    },

    supportsLag: true,

    lagCreateLines({ id, members, mode }: LagOpts): string[] {
      assertChannelId(id);
      if (members.length < 2) throw Object.assign(new Error('A LAG needs at least 2 member ports'), { statusCode: 400 });
      const m = mode === 'lacp' ? 'active' : 'on';   // LACP (active) vs static (on)
      return members.flatMap(p => [`interface ${ciscoIface(p)}`, `channel-group ${id} mode ${m}`]);
    },

    lagDeleteLines({ id, members }: LagOpts): string[] {
      assertChannelId(id);
      // `no channel-group` takes NO id - an interface is only ever in one group,
      // and `no channel-group <id>` is rejected as "% Incomplete command" on
      // IOS-XE (verified on a C9300, 17.3). Then remove the empty Port-channel.
      return [
        ...members.flatMap(p => [`interface ${ciscoIface(p)}`, 'no channel-group']),
        `no interface Port-channel ${id}`,
      ];
    },

    loggingTrap(level) {
      return [`logging trap ${level}`];
    }
  };
}
