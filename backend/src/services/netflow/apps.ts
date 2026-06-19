// Best-effort application label from an L4 port, for the traffic breakdown.
// The "server" side of a flow is usually the well-known port, so we check the
// destination port first, then the source port, then fall back to "other".
const PORTS: Record<number, string> = {
  20: 'ftp', 21: 'ftp', 22: 'ssh', 23: 'telnet', 25: 'smtp', 53: 'dns',
  67: 'dhcp', 68: 'dhcp', 69: 'tftp', 80: 'http', 110: 'pop3', 119: 'nntp',
  123: 'ntp', 143: 'imap', 161: 'snmp', 162: 'snmp', 179: 'bgp', 389: 'ldap',
  443: 'https', 445: 'smb', 465: 'smtp', 514: 'syslog', 587: 'smtp',
  636: 'ldaps', 853: 'dns', 873: 'rsync', 993: 'imap', 995: 'pop3',
  1194: 'openvpn', 1701: 'l2tp', 1812: 'radius', 1883: 'mqtt', 1900: 'ssdp',
  3306: 'mysql', 3389: 'rdp', 5060: 'sip', 5061: 'sip', 5201: 'iperf',
  5353: 'mdns', 5432: 'postgres', 5900: 'vnc', 6379: 'redis', 8080: 'http',
  8443: 'https', 8883: 'mqtt', 9000: 'http', 25565: 'minecraft',
  27015: 'steam', 32400: 'plex', 51413: 'bittorrent', 51820: 'wireguard',
};

/** Resolve a flow to an application label and the representative service port. */
export function appFor(_protocol: number, srcPort: number, dstPort: number): { app: string; port: number } {
  if (PORTS[dstPort]) return { app: PORTS[dstPort], port: dstPort };
  if (PORTS[srcPort]) return { app: PORTS[srcPort], port: srcPort };
  // No well-known port: keep the lower of the two as a stable representative.
  const port = srcPort && dstPort ? Math.min(srcPort, dstPort) : (dstPort || srcPort);
  return { app: 'other', port };
}
