// MikroTik RouterOS driver. RouterOS is not IOS-like: no enable mode, config
// auto-persists, and commands are `/path/command` with `[find ...]` selectors.
// See docs/PLAN-multi-vendor.md. Port VLAN config uses bridge-VLAN filtering
// (pvid + per-VLAN tagged/untagged membership), validated against a CRS326.
// Cable test still throws (per-model TDR, inline output doesn't fit run/show).
import type { DeviceDriver, PortConfigOpts, BaselineOpts, BaselinePlan, DeviceToolId, DeviceToolOpts } from './types.js';
import { assertToolTarget } from './types.js';

// ---- bridge VLAN scripting -------------------------------------------------
// Access/trunk assignment is read-modify-write: a port must be removed from the
// VLANs it no longer belongs to and added to the ones it does. RouterOS has no
// single command for that, so each assignment is one idempotent script that
// derives the bridge from the port, fixes pvid/frame-types, strips the port
// from every VLAN row, then re-adds it where it belongs. Re-running is a no-op.
//
// IMPORTANT: VLANs are only *enforced* once the bridge has vlan-filtering=yes.
// Flipping that bridge-wide switch can cut management, so it is a deliberate
// admin action and is intentionally NOT done here - this stages membership so
// it is correct the moment filtering is enabled. vendor: mikrotik.

/** RouterOS interface names are letters/digits/-/+ (ether1, sfp-sfpplus1). */
function rosPort(port: string): string {
  if (!/^[\w+\-]+$/.test(port)) throw Object.assign(new Error(`invalid RouterOS port name: ${port}`), { statusCode: 400 });
  return port;
}

/** "10,20,30-32" -> [10,20,30,31,32]. */
function parseVlanList(spec?: string): number[] {
  if (!spec) return [];
  const out = new Set<number>();
  for (const part of spec.split(',')) {
    const t = part.trim();
    const range = t.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) { for (let i = +range[1]; i <= +range[2]; i++) out.add(i); }
    else if (/^\d+$/.test(t)) out.add(+t);
  }
  return [...out].sort((a, b) => a - b);
}

// Within a `:foreach row` over the bridge's VLAN rows, drop $p from both lists.
const STRIP_PORT =
  ':foreach row in=[/interface bridge vlan find where bridge=$br] do={' +
    ':local u [/interface bridge vlan get $row untagged]; :local t [/interface bridge vlan get $row tagged];' +
    ':local nu [:toarray ""]; :foreach m in=$u do={ :if ($m != $p) do={ :set nu ($nu,$m) } };' +
    ':local nt [:toarray ""]; :foreach m in=$t do={ :if ($m != $p) do={ :set nt ($nt,$m) } };' +
    '/interface bridge vlan set $row untagged=$nu tagged=$nt }';

/** Ensure a VLAN row exists and includes $p in `list` (untagged|tagged). */
function ensureMember(list: 'untagged' | 'tagged', vlanExpr: string): string {
  return `:if ([:len [/interface bridge vlan find where bridge=$br and vlan-ids=${vlanExpr}]] = 0) do={` +
         ` /interface bridge vlan add bridge=$br vlan-ids=${vlanExpr} ${list}=$p } else={` +
         ` :local r [/interface bridge vlan find where bridge=$br and vlan-ids=${vlanExpr}];` +
         ` :local cur [/interface bridge vlan get $r ${list}];` +
         ` :if ([:typeof [:find $cur $p]] = "nil") do={ /interface bridge vlan set $r ${list}=($cur,$p) } }`;
}

const SCRIPT_HEAD = (port: string) =>
  `:local p "${port}"; :local br [/interface bridge port get [find interface=$p] bridge];`;

function accessVlanScript(port: string, vlan: number): string {
  return `${SCRIPT_HEAD(port)}` +
    ` /interface bridge port set [find interface=$p] pvid=${vlan} frame-types=admit-only-untagged-and-priority-tagged;` +
    ` ${STRIP_PORT};` +
    ` ${ensureMember('untagged', String(vlan))}`;
}

function trunkScript(port: string, native: number, allowed: number[]): string {
  const arr = `{${allowed.join(';')}}`;
  return `${SCRIPT_HEAD(port)}` +
    ` /interface bridge port set [find interface=$p] pvid=${native} frame-types=admit-all;` +
    ` ${STRIP_PORT};` +
    ` ${ensureMember('untagged', String(native))}` +
    (allowed.length ? `; :foreach vv in=${arr} do={ ${ensureMember('tagged', '$vv')} }` : '');
}

const SPEED_MAP: Record<string, string> = { '10': '10Mbps', '100': '100Mbps', '1000': '1Gbps', '10000': '10Gbps' };

/** RouterOS has no severity levels; it filters by log topic. Map a Cisco-style
 *  trap level onto the set of topics to forward. IMPORTANT: RouterOS ANDs
 *  multiple topics within a single rule (a rule with topics=info,warning only
 *  matches a message tagged with BOTH), so each topic needs its OWN rule. */
const TOPICS_FOR_LEVEL: Record<string, string[]> = {
  emergencies:    ['critical'],
  alerts:         ['critical'],
  critical:       ['critical'],
  errors:         ['error', 'critical'],
  warnings:       ['warning', 'error', 'critical'],
  notifications:  ['info', 'warning', 'error', 'critical'],
  informational:  ['info', 'warning', 'error', 'critical'],
  debugging:      ['debug', 'info', 'warning', 'error', 'critical'],
};

/** Reset and recreate the remote-logging rules for the switchpilot action,
 *  one rule per topic (see the AND note above). */
function loggingRules(topics: string[]): string[] {
  return ['/system/logging/remove [find action=switchpilot]',
          ...topics.map(t => `/system/logging/add action=switchpilot topics=${t}`)];
}

function unsupported(feature: string): never {
  throw Object.assign(
    new Error(`${feature} is not yet supported on RouterOS (see PLAN-multi-vendor #6)`),
    { statusCode: 501 }
  );
}

export function routerosDriver(): DeviceDriver {
  return {
    vendor: 'mikrotik',
    os: 'routeros',
    // RouterOS logs straight in as the admin user; there is no enable step.
    skipEnable: true,
    // Config is applied live and persisted automatically - nothing to save.
    saveCommand: '',
    // hide-sensitive keeps passwords/keys out of stored backups.
    configCommand: '/export hide-sensitive',

    baseline(o: BaselineOpts): BaselinePlan {
      // Neighbor discovery (MNDP/CDP/LLDP) feeds Topology and Discovery.
      const lines: string[] = ['/ip/neighbor/discovery-settings/set discover-interface-list=all'];
      const notes: string[] = ['neighbor discovery on all interfaces: MNDP/CDP/LLDP for Topology and Discovery'];

      if (o.platformHost) {
        lines.push(
          // Create-or-update the remote action idempotently (re-applying baseline
          // must not fail on a duplicate name). bsd-syslog=yes sends an RFC3164
          // <PRI> so the platform can parse severity/facility.
          `:local a [/system/logging/action/find name=switchpilot]; :if ([:len $a]=0) do={/system/logging/action/add name=switchpilot target=remote remote=${o.platformHost} remote-port=514 bsd-syslog=yes} else={/system/logging/action/set $a remote=${o.platformHost} remote-port=514 bsd-syslog=yes}`,
          ...loggingRules(TOPICS_FOR_LEVEL.informational)
        );
        notes.push(`syslog forwarding to ${o.platformHost} (UDP 514): real-time link/config alerts`);
      } else {
        notes.push('PLATFORM_URL not set - skipped syslog forwarding');
      }

      if (o.snmpVersion && o.snmpVersion !== '3') {
        const community = o.snmpCommunity ?? '';
        if (community) {
          if (/^[\w.\-]+$/.test(community)) {
            lines.push(
              `/snmp/community/add name=${community} addresses=0.0.0.0/0 read-access=yes`,
              '/snmp/set enabled=yes'
            );
            notes.push('SNMP v2c read-only community: fast status polling without SSH');
          } else {
            notes.push('SNMP community contains characters unsafe for a config line - skipped (use letters, digits, . _ -)');
          }
        }
      } else if (o.snmpVersion === '3') {
        notes.push('credential profile uses SNMPv3 - configure /snmp community (v3) manually');
      }

      return { lines, notes };
    },

    setPortAdmin(port, enabled) {
      return [`/interface/set [find name=${port}] disabled=${enabled ? 'no' : 'yes'}`];
    },

    portConfig(port: string, o: PortConfigOpts) {
      rosPort(port);
      const lines: string[] = [];

      if (o.description !== undefined) {
        // Swap quotes/backslashes and strip CR/LF so a comment can't break out
        // of the quoted string or inject extra RouterOS commands.
        const c = o.description.replace(/["\\]/g, "'").replace(/[\r\n]+/g, ' ');
        lines.push(`/interface ethernet set [find default-name=${port}] comment="${c}"`);
      }

      // Forced speed/duplex needs auto-negotiation off; 'auto' restores it.
      if (o.speed === 'auto') {
        lines.push(`/interface ethernet set [find default-name=${port}] auto-negotiation=yes`);
      } else if (o.speed || o.duplex) {
        const parts = ['auto-negotiation=no'];
        if (o.speed && SPEED_MAP[o.speed]) parts.push(`speed=${SPEED_MAP[o.speed]}`);
        if (o.duplex) parts.push(`full-duplex=${o.duplex === 'full' ? 'yes' : 'no'}`);
        lines.push(`/interface ethernet set [find default-name=${port}] ${parts.join(' ')}`);
      }

      // STP edge/bpdu-guard map to the bridge port (portfast -> edge).
      const bp: string[] = [];
      if (o.portfast !== undefined) bp.push(`edge=${o.portfast ? 'yes' : 'auto'}`);
      if (o.bpduGuard !== undefined) bp.push(`bpdu-guard=${o.bpduGuard ? 'yes' : 'no'}`);
      if (bp.length) lines.push(`/interface bridge port set [find interface=${port}] ${bp.join(' ')}`);

      // VLAN membership (voice VLAN and PoE have no RouterOS-switch equivalent here).
      if (o.mode === 'trunk') {
        const native = o.trunkNativeVlan ?? 1;
        const allowed = parseVlanList(o.trunkAllowedVlans).filter(v => v !== native);
        lines.push(trunkScript(port, native, allowed));
      } else if (o.vlan !== undefined) {
        lines.push(accessVlanScript(port, o.vlan));
      }

      return lines;
    },

    // RouterOS port state is spread across bridge-VLAN rows + interface props;
    // there is no single-command read-back we parse the way IOS running-config
    // is parsed, so verification is skipped (null). The vlan-filtering caveat
    // already warns when a staged VLAN is not yet enforced.
    portReadbackCommand() { return null; },

    bounceLines(port) {
      return {
        down: [`/interface/set [find name=${port}] disabled=yes`],
        up: [`/interface/set [find name=${port}] disabled=no`],
      };
    },

    poeCycleLines(port) {
      const p = rosPort(port);
      return {
        off: [`/interface ethernet poe set [find name=${p}] poe-out=off`],
        on: [`/interface ethernet poe set [find name=${p}] poe-out=auto`],
      };
    },

    cableTest(_port: string) {
      // TDR output varies by model and returns inline (no separate read step),
      // which doesn't fit the run/show contract; revisit with hardware.
      return unsupported('Cable test');
    },

    tools: ['ping', 'traceroute', 'ip-scan'],

    toolCommand(tool: DeviceToolId, { target, count }: DeviceToolOpts): string {
      assertToolTarget(target);
      switch (tool) {
        // count bounds ping; ip-scan is bounded by duration. traceroute streams
        // continuously over the exec channel, so the caller time-bounds it.
        case 'ping':       return `/ping ${target} count=${count}`;
        case 'traceroute': return `/tool traceroute ${target}`;
        case 'ip-scan':    return `/tool ip-scan address-range=${target} duration=5`;
        default:
          throw Object.assign(new Error(`${tool} is not supported on RouterOS`), { statusCode: 501 });
      }
    },

    // RouterOS re-prints the whole traceroute/ip-scan table every interval, so a
    // time-bounded capture stacks many copies. Keep the most complete frame (most
    // non-empty lines; latest wins ties), which is also robust to a final frame
    // truncated when the channel closed. Ping is append-only, so it passes through.
    cleanToolOutput(tool: DeviceToolId, raw: string): string {
      if (tool === 'ping') return raw;
      const frames = raw.split(/(?=^Columns:)/m).map(f => f.trim()).filter(Boolean);
      if (frames.length <= 1) return raw.trim();
      const lines = (f: string) => f.split('\n').filter(l => l.trim()).length;
      return frames.reduce((best, f) => (lines(f) >= lines(best) ? f : best), frames[0]);
    },

    loggingTrap(level) {
      return loggingRules(TOPICS_FOR_LEVEL[level] ?? TOPICS_FOR_LEVEL.informational);
    },
  };
}
