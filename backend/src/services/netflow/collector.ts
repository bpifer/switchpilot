// NetFlow/IPFIX UDP collector. Binds a UDP socket (off by default; enable with
// NETFLOW_ENABLED), decodes incoming v5/v9 exports, classifies the application,
// and aggregates flows in memory into one row per (minute, exporter, src, dst,
// protocol, service-port). A 60s timer flushes the aggregate to flow_records.
// Mirrors the syslog listener: not leader-gated, since exporters target one host.
import dgram from 'node:dgram';
import { query } from '../../db.js';
import { config } from '../../config.js';
import { decodeNetflow, type TemplateCache } from './decode.js';
import { appFor } from './apps.js';

interface Agg {
  minute: number; exporter: string; src: string; dst: string;
  protocol: number; port: number; app: string;
  bytes: number; packets: number; flows: number;
}

const buckets = new Map<string, Agg>();
const templates: TemplateCache = new Map();
const exporterDevice = new Map<string, string>();   // positive cache: exporter ip -> device id

let socket: dgram.Socket | null = null;
let flushTimer: NodeJS.Timeout | null = null;

/** Resolve an exporter IP to a managed device id (host() strips any CIDR), the
 *  same way the syslog listener attributes messages. Misses are re-queried. */
async function deviceForExporter(ip: string): Promise<string | null> {
  const hit = exporterDevice.get(ip);
  if (hit) return hit;
  const { rows } = await query<{ id: string }>('SELECT id FROM devices WHERE host(mgmt_ip) = $1 LIMIT 1', [ip]);
  const id = rows[0]?.id ?? null;
  if (id) exporterDevice.set(ip, id);
  return id;
}

function ingest(buf: Buffer, exporter: string): void {
  const flows = decodeNetflow(buf, exporter, templates);
  if (flows.length === 0) return;
  const minute = Math.floor(Date.now() / 60000) * 60;
  for (const fl of flows) {
    if (!fl.srcIp || !fl.dstIp) continue;
    const { app, port } = appFor(fl.protocol, fl.srcPort, fl.dstPort);
    const key = `${minute}|${exporter}|${fl.srcIp}|${fl.dstIp}|${fl.protocol}|${port}`;
    let agg = buckets.get(key);
    if (!agg) {
      agg = { minute, exporter, src: fl.srcIp, dst: fl.dstIp, protocol: fl.protocol, port, app, bytes: 0, packets: 0, flows: 0 };
      buckets.set(key, agg);
    }
    agg.bytes += fl.bytes;
    agg.packets += fl.packets;
    agg.flows += 1;
  }
}

async function flush(): Promise<void> {
  if (buckets.size === 0) return;
  const snapshot = [...buckets.values()];
  buckets.clear();

  // Resolve each unique exporter to a device once for the whole batch.
  const devices = new Map<string, string | null>();
  for (const ex of new Set(snapshot.map(a => a.exporter))) devices.set(ex, await deviceForExporter(ex));

  const CHUNK = 500;   // 11 params/row keeps each statement well under PG limits
  for (let i = 0; i < snapshot.length; i += CHUNK) {
    const chunk = snapshot.slice(i, i + CHUNK);
    const params: unknown[] = [];
    const values = chunk.map(a => {
      const b = params.length;
      params.push(a.minute, devices.get(a.exporter) ?? null, a.exporter, a.src, a.dst, a.protocol, a.port, a.app, a.bytes, a.packets, a.flows);
      return `(to_timestamp($${b + 1}),$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11})`;
    });
    await query(
      `INSERT INTO flow_records (bucket, device_id, exporter_ip, src_ip, dst_ip, protocol, dst_port, app, bytes, packets, flows)
       VALUES ${values.join(',')}
       ON CONFLICT (bucket, exporter_ip, src_ip, dst_ip, protocol, dst_port) DO UPDATE SET
         bytes = flow_records.bytes + EXCLUDED.bytes,
         packets = flow_records.packets + EXCLUDED.packets,
         flows = flow_records.flows + EXCLUDED.flows`, params
    ).catch(err => console.error('[netflow] flush failed:', (err as Error).message));
  }
}

/** Start the UDP collector + flush loop. No-op unless NETFLOW_ENABLED. */
export function startNetflowCollector(): void {
  if (!config.netflow.enabled || socket) return;
  const sock = dgram.createSocket('udp4');
  sock.on('message', (msg, rinfo) => {
    try { ingest(msg, rinfo.address); }
    catch { /* ignore a malformed datagram */ }
  });
  sock.on('error', err => console.error('[netflow] socket error:', err.message));
  sock.bind(config.netflow.port, () => console.log(`[netflow] collector listening on udp/${config.netflow.port}`));
  socket = sock;
  flushTimer = setInterval(() => { void flush(); }, 60_000);
  flushTimer.unref();
}
