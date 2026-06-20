// Event-driven SNMP trap receiver. Mirrors the syslog listener: a UDP listener
// (default 162) that maps well-known traps to alerts, attributing each by source
// IP to a managed device. The trap->alert decision is a pure function exported
// for tests; the net-snmp wiring is the only un-unit-tested part.
import snmp from 'net-snmp';
import { query } from '../db.js';
import { config } from '../config.js';
import { raiseAlert, resolveAlert, type Severity } from './alertService.js';

// SNMPv2-MIB notification OIDs (the value of snmpTrapOID.0 in a v2 trap).
const SNMP_TRAP_OID = '1.3.6.1.6.3.1.1.4.1.0';
const IFINDEX_PREFIX = '1.3.6.1.2.1.2.2.1.1.';   // ifIndex.<N>  (value = N)
const IFDESCR_PREFIX = '1.3.6.1.2.1.2.2.1.2.';   // ifDescr.<N>

export interface ParsedTrap { trapOid?: string; ifIndex?: string; ifDescr?: string; }

export type TrapDecision =
  | { action: 'raise'; kind: string; severity: Severity; message: string }
  | { action: 'resolve'; kind: string }
  | null;

/** Pull the trap OID + interface varbinds out of a trap PDU. Pure (exported for
 *  tests). Handles SNMPv2/v3 (snmpTrapOID.0) and falls back to the SNMPv1
 *  generic-trap code, which maps onto the same well-known OIDs. */
export function parseTrap(pdu: { generic?: number; varbinds?: { oid: string; value: unknown }[] }): ParsedTrap {
  const out: ParsedTrap = {};
  for (const vb of pdu.varbinds ?? []) {
    if (vb.oid === SNMP_TRAP_OID) out.trapOid = String(vb.value);
    else if (vb.oid.startsWith(IFINDEX_PREFIX)) out.ifIndex = String(vb.value);
    else if (vb.oid.startsWith(IFDESCR_PREFIX)) {
      out.ifDescr = Buffer.isBuffer(vb.value) ? vb.value.toString('utf8') : String(vb.value);
    }
  }
  // SNMPv1 trap: no snmpTrapOID varbind. generic 0..4 -> 1.3.6.1.6.3.1.1.5.(g+1).
  if (!out.trapOid && typeof pdu.generic === 'number') {
    out.trapOid = `1.3.6.1.6.3.1.1.5.${pdu.generic + 1}`;
  }
  return out;
}

/** Map a parsed trap to an alert action. Pure (exported for tests). Unknown
 *  traps return null and are ignored. linkUp resolves the matching linkDown so
 *  the alert clears itself; the ifIndex is part of the kind for per-port dedup. */
export function classifyTrap(t: ParsedTrap): TrapDecision {
  const idx = t.ifIndex ?? '?';
  const desc = t.ifDescr ? ` (${t.ifDescr})` : '';
  switch (t.trapOid) {
    case '1.3.6.1.6.3.1.1.5.1':
      return { action: 'raise', kind: 'device_reboot', severity: 'warning', message: 'coldStart trap: device booted (power-cycle or crash)' };
    case '1.3.6.1.6.3.1.1.5.2':
      return { action: 'raise', kind: 'device_reboot', severity: 'info', message: 'warmStart trap: device restarted' };
    case '1.3.6.1.6.3.1.1.5.3':
      return { action: 'raise', kind: `link_down:${idx}`, severity: 'warning', message: `linkDown trap on ifIndex ${idx}${desc}` };
    case '1.3.6.1.6.3.1.1.5.4':
      return { action: 'resolve', kind: `link_down:${idx}` };
    case '1.3.6.1.6.3.1.1.5.5':
      return { action: 'raise', kind: 'snmp_auth_failure', severity: 'warning', message: 'authenticationFailure trap: an SNMP request used a bad community/credential' };
    default:
      return null;
  }
}

// Source IP -> device id cache (mirrors syslog), with a short TTL so a trap
// storm is not a DB SELECT per packet. Negatives are cached too.
const deviceCache = new Map<string, { id: string | null; ts: number }>();
const DEVICE_TTL_MS = 60_000;

async function resolveDevice(ip: string): Promise<string | null> {
  const hit = deviceCache.get(ip);
  if (hit && Date.now() - hit.ts < DEVICE_TTL_MS) return hit.id;
  let id: string | null = null;
  try {
    const { rows } = await query<{ id: string }>('SELECT id FROM devices WHERE host(mgmt_ip) = $1 LIMIT 1', [ip]);
    id = rows[0]?.id ?? null;
  } catch { /* db unavailable - skip */ }
  deviceCache.set(ip, { id, ts: Date.now() });
  return id;
}

async function handleTrap(data: { pdu?: { generic?: number; varbinds?: { oid: string; value: unknown }[] }; rinfo?: { address: string } }): Promise<void> {
  const pdu = data?.pdu;
  const ip = data?.rinfo?.address;
  if (!pdu || !ip) return;
  const decision = classifyTrap(parseTrap(pdu));
  if (!decision) return;
  // Only alert for traps from a managed device; unmanaged sources are ignored.
  const deviceId = await resolveDevice(ip);
  if (!deviceId) return;
  if (decision.action === 'resolve') await resolveAlert(deviceId, decision.kind);
  else await raiseAlert(deviceId, decision.kind, decision.severity, decision.message);
}

/** Start the UDP trap listener. Best-effort: a bind failure (e.g. EACCES on 162
 *  for a non-root process) is delivered to the callback, logged, and ignored. */
export function startSnmpTrapListener(): void {
  const port = config.snmpTrapPort;
  try {
    // disableAuthorization: accept any community, like the syslog listener trusts
    // the management network. Tighten with an authorizer community if exposed.
    snmp.createReceiver({ port, disableAuthorization: true }, (error: NodeJS.ErrnoException | null, data: unknown) => {
      if (error) {
        if (error.code === 'EACCES') {
          console.warn(`snmp traps: cannot bind UDP ${port} - permission denied. Set SNMP_TRAP_PORT > 1024 or grant CAP_NET_BIND_SERVICE.`);
        } else {
          console.warn(`snmp trap listener error: ${error.message}`);
        }
        return;
      }
      handleTrap(data as Parameters<typeof handleTrap>[0])
        .catch(err => console.warn(`snmp trap handler error: ${(err as Error).message}`));
    });
    console.log(`snmp trap listener on UDP ${port}`);
  } catch (err) {
    console.warn(`snmp trap listener failed to start: ${(err as Error).message}`);
  }
}
