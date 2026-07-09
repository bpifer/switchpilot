// Aruba Instant On (phase 1, SNMP read-only): OIDs + pure mappers from walked
// SNMP subtrees to typed structures. The InstantOn 1930 has no usable SSH CLI,
// so its monitor reads standard MIBs (IF-MIB, LLDP-MIB, ENTITY-MIB) instead of
// a shell session. Everything here is pure so it unit-tests against canned
// walk data; the I/O lives in services/arubaMonitor.ts.
//
// NOTE (hardware validation pending): built against standard-MIB behaviour;
// InstantOn quirks (ENTITY indexes, CPU/memory vendor OIDs, LLDP local-port
// numbering) get confirmed when the 1930 is online.

export const ARUBA_OIDS = {
  sysDescr: '1.3.6.1.2.1.1.1.0',
  sysName: '1.3.6.1.2.1.1.5.0',
  sysUpTime: '1.3.6.1.2.1.1.3.0',
  // IF-MIB (walked subtrees; row index = ifIndex)
  ifType: '1.3.6.1.2.1.2.2.1.3',
  ifAdminStatus: '1.3.6.1.2.1.2.2.1.7',
  ifOperStatus: '1.3.6.1.2.1.2.2.1.8',
  ifName: '1.3.6.1.2.1.31.1.1.1.1',
  ifHighSpeed: '1.3.6.1.2.1.31.1.1.1.15',   // Mbps
  ifAlias: '1.3.6.1.2.1.31.1.1.1.18',       // operator description
  ifHCInOctets: '1.3.6.1.2.1.31.1.1.1.6',
  ifHCOutOctets: '1.3.6.1.2.1.31.1.1.1.10',
  // BRIDGE-MIB / Q-BRIDGE-MIB (read side; write side lives in aruba/write.ts)
  dot1dBasePortIfIndex: '1.3.6.1.2.1.17.1.4.1.2', // bridgePort -> ifIndex
  dot1qPvid: '1.3.6.1.2.1.17.7.1.4.5.1.1',        // bridgePort -> access VLAN
  // LLDP-MIB remote table (rows indexed timeMark.localPortNum.remIndex)
  lldpRemPortId: '1.0.8802.1.1.2.1.4.1.1.7',
  lldpRemPortDesc: '1.0.8802.1.1.2.1.4.1.1.8',
  lldpRemSysName: '1.0.8802.1.1.2.1.4.1.1.9',
  lldpRemSysDesc: '1.0.8802.1.1.2.1.4.1.1.10',
} as const;

/** A walked subtree as returned by snmpWalk: full OID -> value. */
export type Walk = Record<string, string | number>;

/** Pull `<base>.<suffix> -> value` pairs out of a walk, keyed by suffix. */
function bySuffix(walk: Walk, base: string): Map<string, string | number> {
  const out = new Map<string, string | number>();
  const prefix = base + '.';
  for (const [oid, v] of Object.entries(walk)) {
    if (oid.startsWith(prefix)) out.set(oid.slice(prefix.length), v);
  }
  return out;
}

export interface ArubaDetection { isAruba: boolean; model: string; version: string; }

/** Recognize an Instant On from sysDescr and extract model/firmware, e.g.
 *  "Aruba Instant On 1930 48G 4SFP+ Switch, PD.02.11, Linux ...". */
export function detectAruba(sysDescr: string): ArubaDetection {
  const isAruba = /aruba/i.test(sysDescr);
  if (!isAruba) return { isAruba: false, model: '', version: '' };
  const model = sysDescr.match(/((?:Aruba\s+)?Instant\s*On\s+\d+\w*(?:\s+[\w+-]+)*?\s+Switch)/i)?.[1]?.trim()
    ?? sysDescr.split(',')[0].trim();
  // "InstantOn_1930_2.8.0.0 (17)" → "2.8.0.0"; fallback "PD.02.11" style; last fallback "Version X"
  const version = sysDescr.match(/InstantOn[^,\s]+?_([\d]+\.[\d]+\.[\d]+\.[\d]+)/i)?.[1]
    ?? sysDescr.match(/\b([A-Z]{1,3}\.\d{2}\.\d{2,4})\b/)?.[1]
    ?? sysDescr.match(/Version\s+([\w.]+)/i)?.[1] ?? '';
  return { isAruba, model, version };
}

export interface ArubaInterface {
  index: number;
  name: string;
  description: string;      // ifAlias
  adminUp: boolean;
  operStatus: 'connected' | 'notconnect' | 'disabled';
  speedMbps: number | null; // ifHighSpeed; 0/absent -> null
  inOctets: number | null;  // HC counters (null when the agent omits them)
  outOctets: number | null;
}

/** Merge the walked IF-MIB columns into one row per physical/LAG interface.
 *  Filters by ifType: ethernetCsmacd(6) and ieee8023adLag(161) only, so VLAN
 *  SVIs, loopbacks, and the CPU port don't show up as switch ports. */
export function mapInterfaces(walks: {
  ifType: Walk; ifName: Walk; ifAlias: Walk; ifHighSpeed: Walk;
  ifAdminStatus: Walk; ifOperStatus: Walk; ifHCInOctets: Walk; ifHCOutOctets: Walk;
}): ArubaInterface[] {
  const types = bySuffix(walks.ifType, ARUBA_OIDS.ifType);
  const names = bySuffix(walks.ifName, ARUBA_OIDS.ifName);
  const aliases = bySuffix(walks.ifAlias, ARUBA_OIDS.ifAlias);
  const speeds = bySuffix(walks.ifHighSpeed, ARUBA_OIDS.ifHighSpeed);
  const admins = bySuffix(walks.ifAdminStatus, ARUBA_OIDS.ifAdminStatus);
  const opers = bySuffix(walks.ifOperStatus, ARUBA_OIDS.ifOperStatus);
  const inOct = bySuffix(walks.ifHCInOctets, ARUBA_OIDS.ifHCInOctets);
  const outOct = bySuffix(walks.ifHCOutOctets, ARUBA_OIDS.ifHCOutOctets);

  const out: ArubaInterface[] = [];
  for (const [idx, t] of types) {
    const type = Number(t);
    if (type !== 6 && type !== 161) continue;
    const adminUp = Number(admins.get(idx) ?? 1) === 1;
    const oper = Number(opers.get(idx) ?? 2);
    const speed = Number(speeds.get(idx) ?? 0);
    out.push({
      index: parseInt(idx, 10),
      name: String(names.get(idx) ?? `port ${idx}`),
      description: String(aliases.get(idx) ?? ''),
      adminUp,
      operStatus: !adminUp ? 'disabled' : oper === 1 ? 'connected' : 'notconnect',
      speedMbps: speed > 0 ? speed : null,
      inOctets: inOct.has(idx) ? Number(inOct.get(idx)) : null,
      outOctets: outOct.has(idx) ? Number(outOct.get(idx)) : null,
    });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** Per-port access VLAN: join dot1qPvid (keyed by bridge port) with
 *  dot1dBasePortIfIndex (bridge port -> ifIndex). Returns Map<ifIndex, vlanId>.
 *  Ports missing from either walk simply aren't in the map. */
export function mapPvids(walks: { pvid: Walk; basePortIfIndex: Walk }): Map<number, number> {
  const ifIndexByBridgePort = bySuffix(walks.basePortIfIndex, ARUBA_OIDS.dot1dBasePortIfIndex);
  const out = new Map<number, number>();
  for (const [bridgePort, vlan] of bySuffix(walks.pvid, ARUBA_OIDS.dot1qPvid)) {
    const ifIndex = Number(ifIndexByBridgePort.get(bridgePort) ?? 0);
    const vlanId = Number(vlan);
    if (ifIndex > 0 && vlanId > 0) out.set(ifIndex, vlanId);
  }
  return out;
}

export interface CounterSnapshot { ts: number; counters: Record<number, { in: number | null; out: number | null }>; }

/** Octet-counter deltas -> bits/sec since the previous sweep. Null when there
 *  is no previous sample, the counter went backwards (reboot/reset/wrap), or
 *  no time elapsed - a rate of "0 because we can't tell" would be a lie. */
export function computeRates(
  prev: CounterSnapshot | null, cur: CounterSnapshot
): Record<number, { inBps: number | null; outBps: number | null }> {
  const out: Record<number, { inBps: number | null; outBps: number | null }> = {};
  const elapsedSec = prev ? (cur.ts - prev.ts) / 1000 : 0;
  for (const [idxStr, c] of Object.entries(cur.counters)) {
    const idx = Number(idxStr);
    const p = prev?.counters[idx];
    const rate = (pv: number | null | undefined, cv: number | null): number | null => {
      if (!prev || elapsedSec <= 0 || pv == null || cv == null || cv < pv) return null;
      return Math.round(((cv - pv) * 8) / elapsedSec);
    };
    out[idx] = { inBps: rate(p?.in, c.in), outBps: rate(p?.out, c.out) };
  }
  return out;
}

export interface ArubaLldpNeighbor {
  localPortNum: number;   // lldpRemLocalPortNum (usually == ifIndex on InstantOn)
  neighborName: string;
  neighborPort: string;
  platform: string;
}

/** Flatten the LLDP remote table. Row suffix is timeMark.localPortNum.remIndex;
 *  keyed on localPortNum.remIndex so a refreshed timeMark doesn't duplicate. */
export function mapLldpNeighbors(walks: {
  sysName: Walk; portId: Walk; portDesc: Walk; sysDesc: Walk;
}): ArubaLldpNeighbor[] {
  const rows = new Map<string, ArubaLldpNeighbor>();
  const parseRow = (suffix: string) => {
    const parts = suffix.split('.');
    if (parts.length < 3) return null;
    return { key: `${parts[1]}.${parts[2]}`, localPortNum: parseInt(parts[1], 10) };
  };
  const ensure = (suffix: string): ArubaLldpNeighbor | null => {
    const r = parseRow(suffix);
    if (!r) return null;
    if (!rows.has(r.key)) rows.set(r.key, { localPortNum: r.localPortNum, neighborName: '', neighborPort: '', platform: '' });
    return rows.get(r.key)!;
  };
  for (const [sfx, v] of bySuffix(walks.sysName, ARUBA_OIDS.lldpRemSysName)) { const r = ensure(sfx); if (r) r.neighborName = String(v); }
  for (const [sfx, v] of bySuffix(walks.portId, ARUBA_OIDS.lldpRemPortId)) { const r = ensure(sfx); if (r && !r.neighborPort) r.neighborPort = String(v); }
  for (const [sfx, v] of bySuffix(walks.portDesc, ARUBA_OIDS.lldpRemPortDesc)) { const r = ensure(sfx); if (r && String(v)) r.neighborPort = String(v); }
  for (const [sfx, v] of bySuffix(walks.sysDesc, ARUBA_OIDS.lldpRemSysDesc)) { const r = ensure(sfx); if (r) r.platform = String(v).split('\n')[0].slice(0, 120); }
  return [...rows.values()].filter(r => r.neighborName);
}
