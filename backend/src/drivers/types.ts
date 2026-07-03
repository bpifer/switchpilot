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

/** Inputs for pointing a device's NetFlow/IPFIX export at the platform collector. */
export interface FlowExportOpts {
  /** Collector host (the SwitchPilot platform), resolved from PLATFORM_URL. */
  host: string;
  /** Collector UDP port (NETFLOW_PORT). */
  port: number;
  /** The device's known port names (from the ports table). Cisco Flexible
   *  NetFlow attaches its flow monitor per interface, so the driver picks the
   *  physical Ethernet ports out of this list; RouterOS ignores it (its
   *  traffic-flow export is a global `interfaces=all` switch). */
  interfaces?: string[];
  /** The device's own management IP, used as the exported packets' source
   *  address. Without it RouterOS emits from 0.0.0.0, which a NAT'd/containerized
   *  collector drops as a martian source (validated live on a CRS326 -> LXC). */
  srcAddress?: string;
}

/** Diagnostic tools a driver can run from the platform. Read-only and
 *  non-config: they execute on the device but change nothing. */
export type DeviceToolId = 'ping' | 'traceroute' | 'ip-scan';

export interface DeviceToolOpts {
  /** Destination host (ping/traceroute) or IPv4 address/CIDR (ip-scan).
   *  Charset-validated by the caller; drivers MUST re-check before interpolating. */
  target: string;
  /** Probe count for ping/traceroute (ignored by ip-scan). */
  count: number;
}

/** Hard charset boundary for any tool target before it reaches a device CLI:
 *  IPv4/IPv6 literals, hostnames, and IPv4 CIDR only - no whitespace and no CLI
 *  metacharacters (`;` `|` `&` `$` `[` `]` quotes ...), so a target can never
 *  break out of the command on either IOS or RouterOS. */
export const TOOL_TARGET_RE = /^[A-Za-z0-9._:/-]{1,64}$/;

export function assertToolTarget(target: string): void {
  if (!TOOL_TARGET_RE.test(target)) {
    throw Object.assign(new Error('Invalid tool target'), { statusCode: 400 });
  }
}

/** Inputs for arming a commit-confirm auto-revert. */
export interface RevertGuardOpts {
  /** Unique, charset-safe name for the snapshot + scheduled revert. */
  token: string;
  /** Seconds before an unconfirmed change auto-reverts. */
  seconds: number;
}

/** A revert token names a backup file and scheduler entry on the device, so it
 *  must be strictly alphanumeric before it reaches the CLI. */
export function assertRevertToken(token: string): void {
  if (!/^[A-Za-z0-9]{4,40}$/.test(token)) {
    throw Object.assign(new Error('Invalid revert token'), { statusCode: 400 });
  }
}

/** Inputs for creating a link-aggregation group (port-channel / bond). */
export interface LagOpts {
  /** RouterOS bond name (e.g. "bond1") or Cisco channel-group id (e.g. "1"). */
  id: string;
  /** Member port names (>= 2). */
  members: string[];
  /** LACP (active negotiation) or static (always-on). */
  mode: 'lacp' | 'static';
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
  /** Command that dumps one port's effective config, for read-back verification
   *  after an edit. null when the vendor has no single-port read-back we can
   *  reliably parse (RouterOS), so callers skip verification. */
  portReadbackCommand(port: string): string | null;
  /** Admin bounce, split so the caller can pause between the two phases. */
  bounceLines(port: string): { down: string[]; up: string[] };
  /** PoE power-cycle: power-off lines then power-on lines (caller pauses between). */
  poeCycleLines(port: string): { off: string[]; on: string[] };
  /** TDR cable test: a command to start it and a command to read results. */
  cableTest(port: string): { run: string; show: string };
  /** Set which syslog severities are forwarded. */
  loggingTrap(level: string): string[];

  /** Diagnostic tools this driver supports (subset of DeviceToolId). The UI
   *  only offers these for the device's vendor. */
  readonly tools: DeviceToolId[];
  /** Build the CLI command for a diagnostic tool. Re-guards the target and
   *  throws (400) on bad input or (501) for a tool not in `tools`. */
  toolCommand(tool: DeviceToolId, opts: DeviceToolOpts): string;

  /** Optional post-processing of a tool's raw device output. RouterOS streams
   *  traceroute/ip-scan as a whole-table re-print every interval, so a bounded
   *  capture stacks many copies; this collapses them to the final frame. Omitted
   *  by drivers whose tools emit append-only output. */
  cleanToolOutput?(tool: DeviceToolId, raw: string): string;

  /** Config lines that point the device's NetFlow/IPFIX export at the platform
   *  collector, idempotently (safe to re-run). Throws unsupported (501) on a
   *  vendor not yet validated for it. */
  flowExportLines(opts: FlowExportOpts): string[];

  /** Whether this driver supports commit-confirm (arm/disarm auto-revert). */
  readonly supportsCommitConfirm: boolean;
  /** A trivial command proving the device CLI still responds (reachability probe). */
  readonly probeCommand: string;
  /** Lines that arm an auto-revert: snapshot current state and schedule a full
   *  restore in `seconds` unless disarmed. Throws unsupported (501) when the
   *  driver does not support commit-confirm. */
  armRevertLines(opts: RevertGuardOpts): string[];
  /** Lines that cancel the armed revert and clean up its snapshot. */
  disarmRevertLines(token: string): string[];

  /** Whether this driver supports link aggregation (LAG / port-channel / bond). */
  readonly supportsLag: boolean;
  /** Lines to create a LAG (LACP or static) from member ports. */
  lagCreateLines(opts: LagOpts): string[];
  /** Lines to remove a LAG and return its members to normal switching. */
  lagDeleteLines(opts: LagOpts): string[];
}
