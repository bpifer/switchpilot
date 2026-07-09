// Aruba Instant On synthetic config snapshot.
//
// Instant On switches have no CLI, so there is no native "running config" to
// back up. Instead we render the SNMP-derived state SwitchPilot already polls
// (devices + ports + topology_links rows) into a stable, line-oriented text.
// That one representation gives Aruba devices config history / diffs AND lets
// the line/regex compliance engine evaluate them without a special code path.
//
// The format is deliberately one line per fact so `regex_present`/`regex_absent`
// rules can match single lines:
//
//   hostname SW-LAB-01
//   model Aruba Instant On 1930 24G Switch
//   version 2.8.0.0
//   interface 1 name "uplink to core" vlan 10 enabled connected
//   interface 2 name "" vlan 1 enabled notconnect
//   lldp neighbor local-port 1 name core-sw port Gi1/0/28
//
// Changing this format breaks the seeded vendor='aruba' compliance rules in
// migrations - update those patterns together with this file.

export interface SyntheticIdentity {
  hostname: string;
  model: string;
  version: string;   // devices.ios_version
}

export interface SyntheticPort {
  name: string;
  description: string;
  admin_up: boolean;
  oper_status: string;   // connected | notconnect | disabled
  vlan: string;          // access VLAN (PVID) as text; '' when unknown
}

export interface SyntheticNeighbor {
  local_port: string;
  neighbor_name: string;
  neighbor_port: string;
}

/** Natural sort for port names: "2" < "10", "lag 2" < "lag 10". */
function portOrder(a: string, b: string): number {
  const na = parseInt(a.replace(/\D+/g, ''), 10);
  const nb = parseInt(b.replace(/\D+/g, ''), 10);
  const pa = a.replace(/\d+/g, '');
  const pb = b.replace(/\d+/g, '');
  return pa === pb ? (na || 0) - (nb || 0) : pa.localeCompare(pb);
}

export function renderArubaConfig(
  identity: SyntheticIdentity,
  ports: SyntheticPort[],
  neighbors: SyntheticNeighbor[],
): string {
  const lines: string[] = [
    '! Synthetic snapshot rendered by SwitchPilot from SNMP state',
    '! (Aruba Instant On exposes no CLI config; this text backs history + compliance)',
    `hostname ${identity.hostname}`,
    `model ${identity.model}`,
    `version ${identity.version}`,
    '!',
  ];

  for (const p of [...ports].sort((a, b) => portOrder(a.name, b.name))) {
    const vlan = p.vlan ? ` vlan ${p.vlan}` : '';
    const admin = p.admin_up ? 'enabled' : 'disabled';
    lines.push(`interface ${p.name} name "${p.description}"${vlan} ${admin} ${p.oper_status}`);
  }
  lines.push('!');

  for (const n of [...neighbors].sort((a, b) => portOrder(a.local_port, b.local_port))) {
    lines.push(`lldp neighbor local-port ${n.local_port} name ${n.neighbor_name} port ${n.neighbor_port}`);
  }
  lines.push('end', '');
  return lines.join('\n');
}
