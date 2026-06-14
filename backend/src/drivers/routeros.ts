// MikroTik RouterOS driver. RouterOS is not IOS-like: no enable mode, config
// auto-persists, and commands are `/path/command` with `[find ...]` selectors.
// See docs/PLAN-multi-vendor.md. The operations that are unambiguous across
// RouterOS models are implemented here with real syntax; the model-dependent
// ones (bridge-VLAN port config #6, per-model TDR) deliberately throw rather
// than push commands we can't verify against hardware yet.
import type { DeviceDriver, PortConfigOpts, BaselineOpts, BaselinePlan } from './types.js';

/** RouterOS has no severity levels; it filters by log topic. Map a Cisco-style
 *  trap level onto the topic set the remote logging rule should carry. */
const TOPICS_FOR_LEVEL: Record<string, string> = {
  emergencies:    'critical,error',
  alerts:         'critical,error',
  critical:       'critical,error',
  errors:         'error,critical',
  warnings:       'warning,error,critical',
  notifications:  'info,warning,error,critical',
  informational:  'info,warning,error,critical',
  debugging:      'debug,info,warning,error,critical',
};

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

    baseline(o: BaselineOpts): BaselinePlan {
      // Neighbor discovery (MNDP/CDP/LLDP) feeds Topology and Discovery.
      const lines: string[] = ['/ip/neighbor/discovery-settings/set discover-interface-list=all'];
      const notes: string[] = ['neighbor discovery on all interfaces: MNDP/CDP/LLDP for Topology and Discovery'];

      if (o.platformHost) {
        lines.push(
          `/system/logging/action/add name=switchpilot target=remote remote=${o.platformHost} remote-port=514`,
          '/system/logging/add action=switchpilot topics=info,warning,error,critical'
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

    portConfig(_port: string, _opts: PortConfigOpts) {
      // RouterOS access/trunk VLANs use bridge VLAN filtering (pvid + tagged
      // members), a different model from Cisco switchport. Tracked as #6.
      return unsupported('Port VLAN/mode configuration');
    },

    bounceLines(port) {
      return {
        down: [`/interface/set [find name=${port}] disabled=yes`],
        up: [`/interface/set [find name=${port}] disabled=no`],
      };
    },

    cableTest(_port: string) {
      // TDR output varies by model and returns inline (no separate read step),
      // which doesn't fit the run/show contract; revisit with hardware.
      return unsupported('Cable test');
    },

    loggingTrap(level) {
      const topics = TOPICS_FOR_LEVEL[level] ?? 'info,warning,error,critical';
      return [`/system/logging/set [find action=switchpilot] topics=${topics}`];
    },
  };
}
