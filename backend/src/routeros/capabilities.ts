// RouterOS model -> capability resolution. Mirrors cisco/capabilities.ts but
// keyed off the RouterOS board-name (e.g. "CRS326-24G-2S+"). Kept small and
// data-driven so more MikroTik models drop in without code changes.
// vendor: mikrotik.

export interface RosModelDef {
  label: string;
  /** Regexes matched (case-insensitive) against the board-name. */
  patterns: string[];
  capabilities: Record<string, unknown>;
}

// Capabilities are intentionally conservative and switch-focused. PoE on the
// CRS3xx line is out (these are non-PoE); models that do PoE-out (e.g. CSS610)
// can override when added.
const MODELS: RosModelDef[] = [
  {
    label: 'Cloud Router Switch 3xx',
    patterns: ['^CRS3\\d{2}'],
    capabilities: { switching: true, vlan: true, bridgeVlanFiltering: true, poe: false, sfp: true, l3HwOffload: true },
  },
  {
    label: 'Cloud Smart Switch',
    patterns: ['^CSS\\d{3}'],
    capabilities: { switching: true, vlan: true, bridgeVlanFiltering: true, poe: 'model', sfp: true, l3HwOffload: false },
  },
];

/** Many MikroTik board-names encode port counts: "<n>G" gigabit copper,
 *  "<n>S" SFP, "<n>S+" SFP+ (10G), "<n>P" PoE ports, "<n>XS" 25G+. */
export function portsFromBoardName(board: string): { gigabit: number; sfp: number; sfpPlus: number } {
  const g = board.match(/(\d+)G(?![a-z])/i);
  const sPlus = board.match(/(\d+)S\+/i);
  const s = board.match(/(\d+)S(?!\+)/i);
  return {
    gigabit: g ? Number(g[1]) : 0,
    sfp: s ? Number(s[1]) : 0,
    sfpPlus: sPlus ? Number(sPlus[1]) : 0,
  };
}

export function modelDefForBoard(board: string): RosModelDef | null {
  const b = board.trim();
  for (const def of MODELS) {
    if (def.patterns.some(p => new RegExp(p, 'i').test(b))) return def;
  }
  return null;
}

/** Resolve effective capabilities for a RouterOS board-name. Always returns
 *  os=routeros and the derived port counts, even for unknown models. */
export function resolveRosCapabilities(board: string): Record<string, unknown> {
  const def = modelDefForBoard(board);
  const ports = portsFromBoardName(board);
  const caps: Record<string, unknown> = {
    os: 'routeros',
    family: def?.label ?? null,
    ports: ports.gigabit + ports.sfp + ports.sfpPlus,
    gigabitPorts: ports.gigabit,
    sfpPlusPorts: ports.sfpPlus,
    sfpPorts: ports.sfp,
    ...(def?.capabilities ?? { switching: true, vlan: true }),
  };
  // "model"-conditional PoE: CRS3xx has none; resolve unknowns to false.
  if (caps.poe === 'model') caps.poe = /\dP\b|-IN\b/i.test(board);
  return caps;
}
