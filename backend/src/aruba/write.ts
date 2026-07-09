// Aruba Instant On SNMP write operations (phase 2).
// Handles port admin up/down, bounce, description, access VLAN, and trunk VLAN
// membership for devices that have no SSH CLI. All operations go through
// Q-BRIDGE-MIB and IF-MIB standard writes; the 1930 confirms all are writable.
//
// Bridge-port numbering note: on the 1930 the bridge port number equals the
// ifIndex (port "1" = bridge port 1, SFP port at ifIndex 49 = bridge port 49).
// getBridgePortMap() confirms this at runtime rather than assuming it.

import snmp from 'net-snmp';
import { snmpSet, snmpWalkRaw, snmpGetRaw, snmpWalk, OIDS, type SnmpVarbind } from '../cisco/snmpClient.js';
import { getDevice, snmpTargetFor, assertNotUplink, type DeviceRow } from '../services/deviceComms.js';
import { redis } from '../redis.js';

// ── OID constants ────────────────────────────────────────────────────────────
const OID = {
  ifAdminStatus:              OIDS.ifAdminStatus,
  ifAlias:                    OIDS.ifAlias,
  dot1dBasePortIfIndex:       OIDS.dot1dBasePortIfIndex,
  dot1qPvid:                  OIDS.dot1qPvid,
  dot1qVlanStaticName:        OIDS.dot1qVlanStaticName,
  dot1qVlanStaticEgressPorts: OIDS.dot1qVlanStaticEgressPorts,
  dot1qVlanStaticUntaggedPorts: OIDS.dot1qVlanStaticUntaggedPorts,
};

// SNMP ObjectType constants from net-snmp
const T = {
  Integer:     snmp.ObjectType.Integer     as number,
  OctetString: snmp.ObjectType.OctetString as number,
  Gauge:       snmp.ObjectType.Gauge       as number,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Aruba port names are bare numbers ("1", "24", "49").  ifIndex = portName. */
function ifIndexOf(portName: string): number {
  const n = parseInt(portName, 10);
  if (isNaN(n)) throw new Error(`Non-numeric Aruba port name: "${portName}"`);
  return n;
}

/** Q-BRIDGE bitmap: MSB-first, bit 0 of byte 0 = bridge port 1.
 *  bridge port N → byte floor((N-1)/8), mask 0x80 >> ((N-1) % 8). */
function portBit(bridgePort: number): { byteIdx: number; mask: number } {
  return {
    byteIdx: Math.floor((bridgePort - 1) / 8),
    mask: 0x80 >> ((bridgePort - 1) % 8),
  };
}

/** Return a copy of buf with the given bridge port bit set or cleared.
 *  Grows the buffer if the port falls beyond the current length. */
function bitmapSet(buf: Buffer, bridgePort: number, on: boolean): Buffer {
  const { byteIdx, mask } = portBit(bridgePort);
  const out = Buffer.alloc(Math.max(buf.length, byteIdx + 1));
  buf.copy(out);
  if (on) out[byteIdx] |= mask;
  else    out[byteIdx] &= ~mask;
  return out;
}

// ── Bridge port map ──────────────────────────────────────────────────────────

const BPMAP_KEY = (id: string) => `device:${id}:bridgePortMap`;

/** Walk dot1dBasePortIfIndex → Map<ifIndex, bridgePortNum>.
 *  Cached in redis for 1 hour to avoid an extra walk on every port op. */
export async function getBridgePortMap(
  deviceId: string, target: Parameters<typeof snmpSet>[0]
): Promise<Map<number, number>> {
  try {
    const cached = await redis.get(BPMAP_KEY(deviceId));
    if (cached) {
      const obj: Record<string, number> = JSON.parse(cached);
      return new Map(Object.entries(obj).map(([k, v]) => [Number(k), v]));
    }
  } catch { /* cache miss - fetch live */ }

  const rows = await snmpWalk(target, OID.dot1dBasePortIfIndex);
  // entries: { '{base}.{bridgePort}': ifIndex }
  const map = new Map<number, number>();
  const forCache: Record<number, number> = {};
  for (const [oid, ifIdx] of Object.entries(rows)) {
    const bridgePort = parseInt(oid.split('.').pop() ?? '0', 10);
    const ifIndex = Number(ifIdx);
    if (bridgePort > 0 && ifIndex > 0) {
      map.set(ifIndex, bridgePort);
      forCache[ifIndex] = bridgePort;
    }
  }
  await redis.set(BPMAP_KEY(deviceId), JSON.stringify(forCache), 'EX', 3600).catch(() => {});
  return map;
}

// ── VLAN list ────────────────────────────────────────────────────────────────

export interface ArubaVlan { id: number; name: string }

/** Walk dot1qVlanStaticName → [{id, name}] for every configured VLAN. */
export async function getVlans(target: Parameters<typeof snmpSet>[0]): Promise<ArubaVlan[]> {
  const rows = await snmpWalk(target, OID.dot1qVlanStaticName);
  return Object.entries(rows).map(([oid, name]) => ({
    id: parseInt(oid.split('.').pop() ?? '0', 10),
    name: String(name),
  })).filter(v => v.id > 0).sort((a, b) => a.id - b.id);
}

// ── Low-level port writes ─────────────────────────────────────────────────────

/** Set ifAdminStatus for a port by ifIndex. */
async function setAdminStatus(
  target: Parameters<typeof snmpSet>[0], ifIndex: number, up: boolean
): Promise<void> {
  await snmpSet(target, [{
    oid: `${OID.ifAdminStatus}.${ifIndex}`,
    type: T.Integer,
    value: up ? 1 : 2,
  }]);
}

/** Set ifAlias (port description) by ifIndex. */
async function setAlias(
  target: Parameters<typeof snmpSet>[0], ifIndex: number, description: string
): Promise<void> {
  await snmpSet(target, [{
    oid: `${OID.ifAlias}.${ifIndex}`,
    type: T.OctetString,
    value: description,
  }]);
}

/** Set access VLAN (dot1qPvid) for a bridge port. */
async function setPvid(
  target: Parameters<typeof snmpSet>[0], bridgePort: number, vlanId: number
): Promise<void> {
  await snmpSet(target, [{
    oid: `${OID.dot1qPvid}.${bridgePort}`,
    type: T.Gauge,
    value: vlanId,
  }]);
}

/** Read the egress and untagged bitmaps for a VLAN, returned as raw Buffers.
 *  The 1930 uses a .0.{vlanId} row index in both static bitmap tables. */
async function readVlanBitmaps(
  target: Parameters<typeof snmpSet>[0], vlanId: number
): Promise<{ egressOid: string; untaggedOid: string; egress: Buffer; untagged: Buffer }> {
  const egressOid   = `${OID.dot1qVlanStaticEgressPorts}.0.${vlanId}`;
  const untaggedOid = `${OID.dot1qVlanStaticUntaggedPorts}.0.${vlanId}`;
  const raw = await snmpGetRaw(target, [egressOid, untaggedOid]);

  const toBuffer = (v: Buffer | string | number | undefined): Buffer => {
    if (Buffer.isBuffer(v)) return v;
    if (typeof v === 'string') return Buffer.from(v, 'binary');
    return Buffer.alloc(8); // 64 ports of zeros as fallback
  };
  return {
    egressOid,
    untaggedOid,
    egress:   toBuffer(raw[egressOid]),
    untagged: toBuffer(raw[untaggedOid]),
  };
}

/** Add or remove a bridge port from a VLAN's egress/untagged bitmaps.
 *  tagged=true: port goes in egress only (trunk tagged member).
 *  tagged=false: port goes in both egress and untagged (access/untagged member).
 *  member=false: port removed from both bitmaps. */
async function setVlanBitmapPort(
  target: Parameters<typeof snmpSet>[0],
  bridgePort: number,
  vlanId: number,
  member: boolean,
  tagged: boolean,
): Promise<void> {
  const bm = await readVlanBitmaps(target, vlanId);
  const newEgress   = bitmapSet(bm.egress,   bridgePort, member);
  // Untagged bit: set only when member AND untagged (access port)
  const newUntagged = bitmapSet(bm.untagged, bridgePort, member && !tagged);

  // Both bitmaps must be SET atomically to avoid InconsistentValue rejection.
  await snmpSet(target, [
    { oid: bm.egressOid,   type: T.OctetString, value: newEgress },
    { oid: bm.untaggedOid, type: T.OctetString, value: newUntagged },
  ]);
}

// ── High-level device operations (accept deviceId, look up device+target) ────

async function resolveTarget(deviceId: string) {
  const device = await getDevice(deviceId);
  const target  = await snmpTargetFor(device);
  if (!target) throw new Error('No SNMP credential configured on this device');
  return { device, target };
}

/** Enable or disable a port admin status.  Uplink-guarded like the Cisco path. */
export async function arubaPortAdmin(
  deviceId: string, portName: string, up: boolean, force: boolean
): Promise<void> {
  const { device, target } = await resolveTarget(deviceId);
  if (!up) await assertNotUplink(device, portName, force);
  await setAdminStatus(target, ifIndexOf(portName), up);
}

/** Bounce a port: admin-down, 1-second pause, admin-up. Uplink-guarded. */
export async function arubaBouncePort(deviceId: string, portName: string, force: boolean): Promise<void> {
  const { device, target } = await resolveTarget(deviceId);
  await assertNotUplink(device, portName, force);
  const ifIndex = ifIndexOf(portName);
  await setAdminStatus(target, ifIndex, false);
  await new Promise(r => setTimeout(r, 1000));
  await setAdminStatus(target, ifIndex, true);
}

/** Apply a port configuration change over SNMP.
 *  Supports: description (ifAlias), access vlan (dot1qPvid),
 *  trunk vlan membership (Q-BRIDGE bitmaps). */
export async function arubaPortConfig(
  deviceId: string,
  portName: string,
  opts: {
    description?: string;
    vlan?: number;           // access VLAN → dot1qPvid
    mode?: 'access' | 'trunk';
    trunkAllowedVlans?: string; // comma/range, e.g. "10,20,30-39"
  }
): Promise<void> {
  const { device: _device, target } = await resolveTarget(deviceId);
  const ifIndex = ifIndexOf(portName);
  const bridgePortMap = await getBridgePortMap(deviceId, target);
  const bridgePort = bridgePortMap.get(ifIndex);

  if (opts.description !== undefined) {
    await setAlias(target, ifIndex, opts.description);
  }

  if (bridgePort !== undefined) {
    // Access VLAN: simplest path — just update dot1qPvid
    if (opts.mode !== 'trunk' && opts.vlan !== undefined) {
      await setPvid(target, bridgePort, opts.vlan);
    }

    // Trunk VLAN membership: bitmap read-modify-write per VLAN
    if (opts.mode === 'trunk' && opts.trunkAllowedVlans !== undefined) {
      const allowed = parseVlanList(opts.trunkAllowedVlans);
      // Get current VLANs configured on device to know the full list
      const allVlans = await getVlans(target);
      for (const { id } of allVlans) {
        const shouldBeMember = allowed.length === 0 || allowed.includes(id);
        await setVlanBitmapPort(target, bridgePort, id, shouldBeMember, true /* tagged */);
      }
    }
  }
}

/** Parse a Cisco-style VLAN list ("10,20,30-39") into an array of VLAN IDs. */
export function parseVlanList(spec: string): number[] {
  if (!spec.trim()) return [];
  const ids: number[] = [];
  for (const part of spec.split(',')) {
    const range = part.trim().split('-');
    if (range.length === 2) {
      const lo = parseInt(range[0], 10);
      const hi = parseInt(range[1], 10);
      for (let v = lo; v <= hi && v <= 4094; v++) ids.push(v);
    } else {
      const v = parseInt(part.trim(), 10);
      if (!isNaN(v)) ids.push(v);
    }
  }
  return ids;
}

/** Fetch VLANs for a device (wraps getVlans with device lookup). */
export async function arubaGetVlans(deviceId: string): Promise<ArubaVlan[]> {
  const { target } = await resolveTarget(deviceId);
  return getVlans(target);
}
