// Parsers for Cisco IOS / IOS-XE "show" command output.
// These operate on raw CLI text and are covered by unit tests in tests/parsers.test.ts.

export interface ShowVersionInfo {
  hostname: string;
  model: string;
  serial: string;
  iosVersion: string;
  uptimeSeconds: number;
}

export function parseShowVersion(output: string): ShowVersionInfo {
  // NX-OS uses "Device name:" instead of "<hostname> uptime is"
  const hostname =
    output.match(/Device name:\s*(\S+)/)?.[1] ??
    output.match(/^(\S+)\s+uptime is/m)?.[1] ?? '';

  // NX-OS: "cisco N5K-C5596UP Chassis" or "cisco Nexus5596UP"
  // IOS:   "Model number : WS-C2960X-48FPD-L"
  // IOS-XE: "Model Number : C9300-48P"
  const model =
    output.match(/Model [Nn]umber\s*:\s*(\S+)/)?.[1] ??
    output.match(/^cisco\s+(N[59357][Kk]-\S+|N[0-9]{4}\S*|WS-\S+|C9\d{3}\S*)\s+/m)?.[1] ??
    output.match(/Hardware\s*\n\s*cisco\s+(\S+)/m)?.[1] ?? '';

  const serial =
    output.match(/System [Ss]erial [Nn]umber\s*:\s*(\S+)/)?.[1] ??
    output.match(/Processor board ID\s+(\S+)/)?.[1] ?? '';

  // NX-OS: "NXOS: version 7.3(9)N1(1)" or "system: version 9.3(8)"
  const iosVersion =
    output.match(/(?:NXOS|system):\s+version\s+([\w.()]+)/i)?.[1] ??
    output.match(/Version\s+([\w.()]+?)[,\s]/)?.[1] ?? '';

  let uptimeSeconds = 0;
  // NX-OS: "Kernel uptime is 0 day(s), 3 hour(s), 14 minute(s), 22 second(s)"
  const nxUp = output.match(/Kernel uptime is\s+(.+)/)?.[1] ?? '';
  const iosUp = output.match(/uptime is\s+(.+)/)?.[1] ?? '';
  const up = nxUp || iosUp;
  const grab = (re: RegExp) => parseInt(up.match(re)?.[1] ?? '0', 10);
  uptimeSeconds =
    grab(/(\d+)\s+year/) * 31536000 +
    grab(/(\d+)\s+week/) * 604800 +
    grab(/(\d+)\s+day/) * 86400 +
    grab(/(\d+)\s+hour/) * 3600 +
    grab(/(\d+)\s+minute/) * 60;

  return { hostname, model, serial, iosVersion, uptimeSeconds };
}

export interface InterfaceStatus {
  name: string;
  description: string;
  status: string; // connected | notconnect | disabled | err-disabled | ...
  vlan: string;   // number | trunk | routed
  duplex: string;
  speed: string;
  type: string;
}

/** Parse `show interfaces status`. Columns are fixed-width-ish; parse from the right. */
export function parseInterfacesStatus(output: string): InterfaceStatus[] {
  const results: InterfaceStatus[] = [];
  for (const line of output.split('\n')) {
    const m = line.match(
      /^(\S+)\s+(.*?)\s+(connected|notconnect|disabled|err-disabled|inactive|monitoring|suspended)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/
    );
    if (!m) continue;
    const [, name, description, status, vlan, duplex, speed, type] = m;
    if (!/^(Gi|Fa|Te|Tw|Fo|Hu|Po|Eth|Ap)/.test(name)) continue;
    results.push({ name, description: description.trim(), status, vlan, duplex, speed, type: type.trim() });
  }
  return results;
}

export interface MacEntry { vlan: number; mac: string; type: string; port: string; }

/** Parse `show mac address-table`. */
export function parseMacTable(output: string): MacEntry[] {
  const entries: MacEntry[] = [];
  for (const line of output.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+([0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4})\s+(\S+)\s+(\S+)\s*$/i);
    if (m) entries.push({ vlan: parseInt(m[1], 10), mac: m[2].toLowerCase(), type: m[3], port: m[4] });
  }
  return entries;
}

export interface CdpNeighbor {
  localPort: string;
  neighborName: string;
  neighborPort: string;
  neighborIp: string;
  platform: string;
}

/** Parse `show cdp neighbors detail`. */
export function parseCdpNeighborsDetail(output: string): CdpNeighbor[] {
  const neighbors: CdpNeighbor[] = [];
  for (const block of output.split(/-{4,}/)) {
    const name = block.match(/Device ID:\s*(\S+)/)?.[1];
    if (!name) continue;
    neighbors.push({
      neighborName: name.split('.')[0],
      neighborIp: block.match(/IP(?:v4)? address:\s*(\S+)/i)?.[1] ?? '',
      platform: block.match(/Platform:\s*([^,]+),/)?.[1]?.replace(/^cisco\s+/i, '').trim() ?? '',
      localPort: block.match(/Interface:\s*([^,]+),/)?.[1]?.trim() ?? '',
      neighborPort: block.match(/Port ID \(outgoing port\):\s*(\S+)/)?.[1] ?? ''
    });
  }
  return neighbors;
}

/** Parse `show lldp neighbors detail`. */
export function parseLldpNeighborsDetail(output: string): CdpNeighbor[] {
  const neighbors: CdpNeighbor[] = [];
  for (const block of output.split(/^-{4,}$/m)) {
    const name = block.match(/System Name:\s*(\S+)/)?.[1];
    if (!name) continue;
    neighbors.push({
      neighborName: name.split('.')[0],
      neighborIp: block.match(/Management Addresses:\s*\n\s*IP:\s*(\S+)/)?.[1] ?? '',
      platform: block.match(/System Description:\s*\n?\s*([^\n]+)/)?.[1]?.trim() ?? '',
      localPort: block.match(/Local Intf:\s*(\S+)/)?.[1] ?? '',
      neighborPort: block.match(/Port id:\s*(\S+)/)?.[1] ?? ''
    });
  }
  return neighbors;
}

/** Parse `show processes cpu` first line → five-second / one-minute / five-minute %. */
export function parseCpu(output: string): { fiveSec: number; oneMin: number; fiveMin: number } {
  const m = output.match(
    /CPU utilization for five seconds:\s*(\d+)%(?:\/\d+%)?;\s*one minute:\s*(\d+)%;\s*five minutes:\s*(\d+)%/
  );
  return {
    fiveSec: m ? parseInt(m[1], 10) : 0,
    oneMin: m ? parseInt(m[2], 10) : 0,
    fiveMin: m ? parseInt(m[3], 10) : 0
  };
}

/** Parse `show processes memory` (IOS/IOS-XE) or `show system resources` (NX-OS) → used %. */
export function parseMemory(output: string): number {
  // NX-OS: "Memory usage:   4031440K total,  3101988K used,   929452K free"
  const nxos = output.match(/Memory usage:\s*(\d+)K total,\s*(\d+)K used/i);
  if (nxos) {
    const total = parseInt(nxos[1], 10);
    const used = parseInt(nxos[2], 10);
    return total > 0 ? Math.round((used / total) * 1000) / 10 : 0;
  }
  // IOS/IOS-XE
  const m = output.match(/Processor Pool Total:\s*(\d+)\s+Used:\s*(\d+)/i)
    ?? output.match(/Processor\s+\S+\s+(\d+)\s+(\d+)\s+\d+/);
  if (!m) return 0;
  const total = parseInt(m[1], 10);
  const used = parseInt(m[2], 10);
  return total > 0 ? Math.round((used / total) * 1000) / 10 : 0;
}

export interface EnvStatus {
  temperatureC: number | null;
  psu: { id: string; status: string }[];
  fans: { id: string; status: string }[];
}

/** Parse `show env all` / `show environment all` (2960/3x50 and 9k formats). */
export function parseEnvironment(output: string): EnvStatus {
  const env: EnvStatus = { temperatureC: null, psu: [], fans: [] };

  const temp =
    output.match(/Temperature Value:\s*([\d.]+)\s*Degree/i) ??
    output.match(/(?:Inlet|System) Temperature Value:\s*([\d.]+)/i);
  if (temp) env.temperatureC = parseFloat(temp[1]);

  // PSU: "POWER SUPPLY 1 is OK" | "SW PID Serial# Status ..." table | "PS1 is OK"
  for (const m of output.matchAll(/(?:POWER SUPPLY|PS)\s*(\w+)\s+is\s+(\S+)/gi)) {
    env.psu.push({ id: m[1], status: m[2].replace(/[.,]$/, '') });
  }
  for (const m of output.matchAll(/^(\d+[AB])\s+\S+\s+\S+\s+(OK|Not Present|No Input Power|Faulty)/gim)) {
    env.psu.push({ id: m[1], status: m[2] });
  }

  // Fans: "FAN 1 is OK" | "FAN in PS-1 is OK" | "Switch 1 FAN 1 is OK"
  for (const m of output.matchAll(/FAN(?:\s+in)?\s+([\w-]+)\s+is\s+(\S+)/gi)) {
    env.fans.push({ id: m[1], status: m[2].replace(/[.,]$/, '') });
  }
  return env;
}

export interface PoePort { port: string; admin: string; oper: string; watts: number; device: string; }

/** Parse `show power inline`. */
export function parsePowerInline(output: string): PoePort[] {
  const ports: PoePort[] = [];
  for (const line of output.split('\n')) {
    const m = line.match(/^(\S+\d\/\d+(?:\/\d+)?)\s+(auto|static|off)\s+(on|off|faulty|power-deny)\s+([\d.]+)\s+(.*?)\s+\d+\s+[\d.]+\s*$/i)
      ?? line.match(/^(\S+\d\/\d+(?:\/\d+)?)\s+(auto|static|off)\s+(on|off|faulty|power-deny)\s+([\d.]+)\s+(.*)$/i);
    if (m) ports.push({ port: m[1], admin: m[2], oper: m[3], watts: parseFloat(m[4]), device: (m[5] ?? '').trim() });
  }
  return ports;
}

export interface StackMember { member: number; role: string; model?: string; serial?: string; state: string; priority: number; macAddress: string; }

/** Parse `show switch` (3750/9200/9300 stacks). */
export function parseShowSwitch(output: string): StackMember[] {
  const members: StackMember[] = [];
  for (const line of output.split('\n')) {
    const m = line.match(/^\s*\*?\s*(\d+)\s+(Active|Standby|Member|Master|Slave)\s+([0-9a-f.]{14})\s+(\d+)\s+\S+\s+(\w+)/i);
    if (m) {
      members.push({
        member: parseInt(m[1], 10), role: m[2], macAddress: m[3],
        priority: parseInt(m[4], 10), state: m[5]
      });
    }
  }
  return members;
}

export interface InterfaceCounters {
  name: string;
  inputErrors: number;
  outputErrors: number;
  inBps: number | null;
  outBps: number | null;
}

/** Parse `show interfaces` for error counters and 5-minute rate samples. */
export function parseInterfaceErrors(output: string): InterfaceCounters[] {
  const results: InterfaceCounters[] = [];
  let current: InterfaceCounters | null = null;
  for (const line of output.split('\n')) {
    const head = line.match(/^(\S+) is (?:up|down|administratively down)/);
    if (head) {
      if (current) results.push(current);
      current = { name: head[1], inputErrors: 0, outputErrors: 0, inBps: null, outBps: null };
      continue;
    }
    if (!current) continue;
    const inErr = line.match(/(\d+) input errors/);
    if (inErr) current.inputErrors = parseInt(inErr[1], 10);
    const outErr = line.match(/(\d+) output errors/);
    if (outErr) current.outputErrors = parseInt(outErr[1], 10);
    const inRate = line.match(/5 minute input rate\s+(\d+)\s+bits\/sec/);
    if (inRate) current.inBps = parseInt(inRate[1], 10);
    const outRate = line.match(/5 minute output rate\s+(\d+)\s+bits\/sec/);
    if (outRate) current.outBps = parseInt(outRate[1], 10);
  }
  if (current) results.push(current);
  return results;
}

export interface PoeTotals { used: number; capacity: number; }

/** Parse the totals summary line(s) from `show power inline`. */
export function parsePowerInlineTotals(output: string): PoeTotals | null {
  // IOS classic: "Available:600.0(w)  Used:123.4(w)"
  let m = output.match(/Available:\s*([\d.]+)\s*\(w\).*?Used:\s*([\d.]+)/i);
  if (m) return { capacity: parseFloat(m[1]), used: parseFloat(m[2]) };
  // IOS-XE table: module row "  1    600.0 W    123.4 W   476.6 W"
  m = output.match(/^\s*\d+\s+([\d.]+)\s+W\s+([\d.]+)\s+W/m);
  if (m) return { capacity: parseFloat(m[1]), used: parseFloat(m[2]) };
  return null;
}

/** Parse `show vlan brief` → [{id, name}]. */
export function parseVlanBrief(output: string): { id: number; name: string; ports: string[] }[] {
  const vlans: { id: number; name: string; ports: string[] }[] = [];
  for (const line of output.split('\n')) {
    const m = line.match(/^(\d+)\s+(\S+)\s+(?:active|act\/unsup|suspended)\s*(.*)$/);
    if (m) {
      vlans.push({
        id: parseInt(m[1], 10),
        name: m[2],
        ports: m[3] ? m[3].split(',').map(p => p.trim()).filter(Boolean) : []
      });
    }
  }
  return vlans;
}

export interface ArpEntry { ip: string; mac: string; }

/**
 * Parse `show ip arp` (IOS/IOS-XE) or `show ip arp` (NX-OS) output.
 * Returns ip→mac mappings; useful for correlating MAC-table entries with IP addresses.
 */
export function parseArpTable(output: string): ArpEntry[] {
  const entries: ArpEntry[] = [];
  for (const line of output.split('\n')) {
    // IOS/IOS-XE: "Internet  10.0.1.1   0   aabb.cc00.0100  ARPA  Vlan10"
    const ios = line.match(/^Internet\s+([\d.]+)\s+\S+\s+([0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4})\s/i);
    if (ios) { entries.push({ ip: ios[1], mac: ios[2].toLowerCase() }); continue; }
    // NX-OS: "10.0.0.1        00:05:40  0050.568c.0001  Ethernet1/1"
    const nxos = line.match(/^([\d.]+)\s+\S+\s+([0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4})\s/i);
    if (nxos) entries.push({ ip: nxos[1], mac: nxos[2].toLowerCase() });
  }
  return entries;
}

/** Normalize short interface names: Gi1/0/1 → GigabitEthernet1/0/1 (for config commands). */
export function expandInterfaceName(short: string): string {
  const map: Record<string, string> = {
    Gi: 'GigabitEthernet', Fa: 'FastEthernet', Te: 'TenGigabitEthernet',
    Tw: 'TwoGigabitEthernet', Fo: 'FortyGigabitEthernet', Hu: 'HundredGigE',
    Po: 'Port-channel'
  };
  const m = short.match(/^([A-Za-z]{2})([\d/.]+)$/);
  if (!m) return short;
  return (map[m[1]] ?? m[1]) + m[2];
}
