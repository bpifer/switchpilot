// Pure parsers for MikroTik RouterOS `print` output. RouterOS is not IOS-like;
// it emits records in three shapes, each handled here:
//   - terse:   one record per line  "<idx> <flags> key=value key=value ..."
//   - keyvalue aligned  "  key: value"   (single-item print, monitor ... once)
//   - columnar "Columns: ..." header then whitespace columns (e.g. health)
// Values may contain spaces without quoting (e.g. last-link-up-time), so the
// terse tokenizer splits on " key=" boundaries, not on every space.
// vendor: mikrotik. Mirrors cisco/parsers.ts for the Cisco side.

export interface RosRecord {
  index: number;
  flags: string[];
  [key: string]: unknown;
}

/** Split a terse value string into key=value pairs, keeping spaces inside values. */
function parseKvPairs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Each pair is key=value where value runs until the next " key=" or end-of-line.
  const re = /([A-Za-z][\w-]*)=(.*?)(?=\s+[A-Za-z][\w-]*=|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) out[m[1]] = m[2];
  return out;
}

/** Parse `... print terse` output into indexed records with flag letters. */
export function parseTerse(output: string): RosRecord[] {
  const records: RosRecord[] = [];
  for (const raw of output.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) continue;
    const lead = line.match(/^\s*(\d+)\s+(.*)$/);
    if (!lead) continue;
    const index = Number(lead[1]);
    const rest = lead[2];
    // Flags are the single letters before the first key=value token.
    const firstKey = rest.search(/[A-Za-z][\w-]*=/);
    const flagStr = firstKey >= 0 ? rest.slice(0, firstKey) : rest;
    const kvStr = firstKey >= 0 ? rest.slice(firstKey) : '';
    const flags = flagStr.replace(/\s+/g, '').split('').filter(Boolean);
    records.push({ index, flags, ...parseKvPairs(kvStr) });
  }
  return records;
}

/** Parse aligned "  key: value" output (resource, routerboard, identity, monitor).
 *  Wrapped continuation lines (no colon) are appended to the previous value. */
export function parseKeyValue(output: string): Record<string, string> {
  const obj: Record<string, string> = {};
  let lastKey = '';
  for (const raw of output.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) continue;
    const m = line.match(/^\s*([A-Za-z][\w-]*)\s*:\s*(.*)$/);
    if (m) { lastKey = m[1]; obj[lastKey] = m[2].trim(); }
    else if (lastKey) { obj[lastKey] += line.trim(); }
  }
  return obj;
}

// ---- typed wrappers ------------------------------------------------------

export interface RosResource {
  platform: string;
  boardName: string;
  version: string;          // e.g. "7.12.1"
  architecture: string;
  cpu: string;
  cpuCount: number;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  uptime: string;
}

const UNIT: Record<string, number> = {
  '': 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4,
};

/** "451.4MiB" -> bytes. Returns 0 when unparseable. */
export function parseSize(s: string | undefined): number {
  if (!s) return 0;
  const m = s.trim().match(/^([\d.]+)\s*([KMGT]iB)?$/);
  if (!m) return 0;
  return Math.round(parseFloat(m[1]) * (UNIT[m[2] ?? ''] ?? 1));
}

export function parseResource(output: string): RosResource {
  const kv = parseKeyValue(output);
  return {
    platform: kv['platform'] ?? '',
    boardName: kv['board-name'] ?? '',
    version: (kv['version'] ?? '').split(/\s+/)[0] ?? '',
    architecture: kv['architecture-name'] ?? '',
    cpu: kv['cpu'] ?? '',
    cpuCount: Number(kv['cpu-count'] ?? 0),
    totalMemoryBytes: parseSize(kv['total-memory']),
    freeMemoryBytes: parseSize(kv['free-memory']),
    uptime: kv['uptime'] ?? '',
  };
}

/** CPU load percentage from `/system resource print` ("cpu-load: 15%"). */
export function parseCpuLoad(resourceOutput: string): number {
  const m = parseKeyValue(resourceOutput)['cpu-load']?.match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

export interface RosRouterboard {
  model: string;
  serialNumber: string;
  currentFirmware: string;
  upgradeFirmware: string;
}

export function parseRouterboard(output: string): RosRouterboard {
  const kv = parseKeyValue(output);
  return {
    model: kv['model'] ?? '',
    serialNumber: kv['serial-number'] ?? '',
    currentFirmware: kv['current-firmware'] ?? '',
    upgradeFirmware: kv['upgrade-firmware'] ?? '',
  };
}

export function parseIdentity(output: string): string {
  return parseKeyValue(output)['name'] ?? '';
}

export interface RosInterface {
  name: string;
  defaultName: string;
  type: string;            // ether | bridge | vlan | ...
  macAddress: string;
  running: boolean;        // flag R
  disabled: boolean;       // flag X
  slave: boolean;          // flag S (bridge/switch member)
  comment?: string;
}

export function parseInterfaces(terse: string): RosInterface[] {
  return parseTerse(terse).map(r => ({
    name: String(r['name'] ?? ''),
    defaultName: String(r['default-name'] ?? r['name'] ?? ''),
    type: String(r['type'] ?? ''),
    macAddress: String(r['mac-address'] ?? '').toUpperCase(),
    running: r.flags.includes('R'),
    disabled: r.flags.includes('X'),
    slave: r.flags.includes('S'),
    ...(r['comment'] ? { comment: String(r['comment']) } : {}),
  }));
}

export interface RosHost {
  mac: string;
  interface: string;       // the physical port the MAC was learned on
  local: boolean;          // flag L: one of the switch's own interface MACs
  dynamic: boolean;        // flag D
}

/** Bridge host (MAC forwarding) table. Local (L) entries are the device's own
 *  interface MACs, not endpoints - callers filter those out for client tracking. */
export function parseBridgeHosts(terse: string): RosHost[] {
  return parseTerse(terse).map(r => ({
    mac: String(r['mac-address'] ?? '').toUpperCase(),
    interface: String(r['on-interface'] ?? r['interface'] ?? ''),
    local: r.flags.includes('L'),
    dynamic: r.flags.includes('D'),
  })).filter(h => h.mac);
}

export interface RosIpAddress {
  address: string;         // with prefix, e.g. 192.168.10.41/24
  ip: string;              // bare host, e.g. 192.168.10.41
  interface: string;
}

export function parseIpAddresses(terse: string): RosIpAddress[] {
  return parseTerse(terse).map(r => {
    const address = String(r['address'] ?? '');
    return {
      address,
      ip: address.split('/')[0] ?? '',
      interface: String(r['actual-interface'] ?? r['interface'] ?? ''),
    };
  }).filter(a => a.ip);
}

export interface RosNeighbor {
  address: string;
  macAddress: string;
  identity: string;
  platform: string;
  board: string;
  interface: string;       // local interface the neighbor was seen on
}

/** `/ip neighbor print terse`. Empty output (no neighbors) yields []. */
export function parseNeighbors(terse: string): RosNeighbor[] {
  return parseTerse(terse).map(r => ({
    address: String(r['address'] ?? ''),
    macAddress: String(r['mac-address'] ?? '').toUpperCase(),
    identity: String(r['identity'] ?? ''),
    platform: String(r['platform'] ?? ''),
    board: String(r['board'] ?? ''),
    interface: String(r['interface'] ?? ''),
  }));
}

/** `/system health print` columnar output -> { name: value }. */
export function parseHealth(output: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const raw of output.split('\n')) {
    const line = raw.replace(/\r$/, '');
    // rows look like: "0  cpu-temperature     56  C"
    const m = line.match(/^\s*\d+\s+([\w-]+)\s+([\d.]+)/);
    if (m) out[m[1]] = parseFloat(m[2]);
  }
  return out;
}

export interface RosPortStatus {
  status: string;          // link-ok | no-link | ...
  rateMbps: number | null; // 1Gbps -> 1000
  fullDuplex: boolean;
  up: boolean;
}

/** `/interface ethernet monitor <port> once` -> link status/speed/duplex. */
export function parseEthernetMonitor(output: string): RosPortStatus {
  const kv = parseKeyValue(output);
  const status = kv['status'] ?? '';
  return {
    status,
    rateMbps: parseRate(kv['rate']),
    fullDuplex: kv['full-duplex'] === 'yes',
    up: status === 'link-ok',
  };
}

export interface RosSfp {
  present: boolean;
  temperatureC: number | null;
  voltageV: number | null;
  txPowerDbm: number | null;
  rxPowerDbm: number | null;
  txBiasMa: number | null;
  vendor: string;
  partNumber: string;
  serial: string;
  wavelengthNm: number | null;
}

/** Parse SFP DDM/optical fields from `/interface ethernet monitor <port> once`. */
export function parseSfpMonitor(output: string): RosSfp {
  const kv = parseKeyValue(output);
  const num = (s: string | undefined) => { const m = (s ?? '').match(/-?[\d.]+/); return m ? parseFloat(m[0]) : null; };
  return {
    present: (kv['sfp-module-present'] ?? 'no').toLowerCase() === 'yes',
    temperatureC: num(kv['sfp-temperature']),
    voltageV: num(kv['sfp-supply-voltage']),
    txPowerDbm: num(kv['sfp-tx-power']),
    rxPowerDbm: num(kv['sfp-rx-power']),
    txBiasMa: num(kv['sfp-tx-bias-current']),
    vendor: kv['sfp-vendor-name'] ?? '',
    partNumber: kv['sfp-vendor-part-number'] ?? '',
    serial: kv['sfp-vendor-serial'] ?? '',
    wavelengthNm: num(kv['sfp-wavelength']),
  };
}

/** "1Gbps" -> 1000, "100Mbps" -> 100, "10Gbps" -> 10000. */
export function parseRate(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.trim().match(/^([\d.]+)\s*(G|M)bps$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return /g/i.test(m[2]) ? n * 1000 : n;
}
