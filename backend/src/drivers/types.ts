// Per-vendor device driver: owns all CLI command strings and config-line
// syntax so services/routes never hardcode a vendor's dialect. A future
// RouterOS driver implements the same interface. See docs/PLAN-multi-vendor.md.

export interface PortConfigOpts {
  description?: string;
  vlan?: number;
  voiceVlan?: number;
  mode?: 'access' | 'trunk';
  trunkNativeVlan?: number;
  trunkAllowedVlans?: string;
  speed?: string;
  duplex?: string;
  portfast?: boolean;
  bpduGuard?: boolean;
  poeEnabled?: boolean;
}

/** Inputs for the baseline SwitchPilot wants on every managed device. */
export interface BaselineOpts {
  snmpVersion?: string | null;
  snmpCommunity?: string | null;
  /** Resolved syslog destination host (no port), or null to skip forwarding. */
  platformHost?: string | null;
}

export interface BaselinePlan {
  lines: string[];
  notes: string[];
}

export interface DeviceDriver {
  readonly vendor: string;        // 'cisco'
  readonly os: string;            // ios | iosxe | nxos | routeros

  /** SSH user already lands at privilege level; skip the enable step. */
  readonly skipEnable: boolean;
  /** Persist running config to startup. Empty when the OS auto-persists
   *  (e.g. RouterOS), so callers skip the save step entirely. */
  readonly saveCommand: string;
  /** Command that dumps the full device configuration for backup/compliance. */
  readonly configCommand: string;

  /** Config lines (and human notes) for SwitchPilot's baseline: neighbor
   *  discovery, syslog forwarding, and optional SNMP read community. */
  baseline(opts: BaselineOpts): BaselinePlan;

  /** Config lines to enable/disable a port. */
  setPortAdmin(port: string, enabled: boolean): string[];
  /** Config lines to apply a full port configuration (incl. interface select). */
  portConfig(port: string, opts: PortConfigOpts): string[];
  /** Admin bounce, split so the caller can pause between the two phases. */
  bounceLines(port: string): { down: string[]; up: string[] };
  /** TDR cable test: a command to start it and a command to read results. */
  cableTest(port: string): { run: string; show: string };
  /** Set which syslog severities are forwarded. */
  loggingTrap(level: string): string[];
}
