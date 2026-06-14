import dgram from 'node:dgram';
import { query } from '../db.js';
import { raiseAlert } from './alertService.js';
import { runAutomationTrigger } from './automationService.js';
import { config } from '../config.js';

// IOS/IOS-XE/NX-OS syslog patterns and their platform events
const PATTERNS: { re: RegExp; handler: (m: RegExpMatchArray, deviceId: string, hostname: string, raw: string) => Promise<void> }[] = [
  {
    // Port went down: %LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet1/0/1, changed state to down
    re: /LINEPROTO-\d+-UPDOWN.*Interface (\S+?),\s*changed state to down/i,
    handler: async (m, deviceId) => {
      await runAutomationTrigger('port_down', { deviceId, port: m[1], source: 'syslog' });
    }
  },
  {
    // Out-of-band config change: %SYS-5-CONFIG_I: Configured from console by admin
    re: /SYS-\d+-CONFIG_I/i,
    handler: async (_m, deviceId, hostname) => {
      await raiseAlert(deviceId, 'config_changed', 'warning',
        `Out-of-band config change detected via syslog on ${hostname}`);
    }
  },
  {
    // NX-OS config change: %VSHD-5-VSHD_SYSLOG_CONFIG_I
    re: /VSHD-\d+-VSHD_SYSLOG_CONFIG_I/i,
    handler: async (_m, deviceId, hostname) => {
      await raiseAlert(deviceId, 'config_changed', 'warning',
        `Out-of-band config change detected via syslog on ${hostname}`);
    }
  },
  {
    // Hardware error
    re: /%-?\d+-HARDWARE_ERR|%PLATFORM-\d+-HARDWARE_ERROR/i,
    handler: async (_m, deviceId, hostname, raw) => {
      await raiseAlert(deviceId, 'hardware_error', 'critical',
        `Hardware error on ${hostname}: ${raw.slice(0, 200)}`);
    }
  },
  {
    // PoE fault
    re: /ILPOWER-\d+-CONTROLLER_ERR|ILPOWER-\d+-ILP_DISABLED/i,
    handler: async (_m, deviceId, hostname, raw) => {
      await raiseAlert(deviceId, 'poe_fault', 'warning',
        `PoE fault on ${hostname}: ${raw.slice(0, 200)}`);
    }
  },
];

// IP -> device cache so a flood from one source isn't a DB SELECT per packet.
// Negative results are cached too (deviceId '') so unknown senders are cheap.
const deviceCache = new Map<string, { deviceId: string; hostname: string; ts: number }>();
const DEVICE_TTL_MS = 60_000;

// Hard cap so a spoofed-source flood (new IP per packet) can't grow the maps
// unbounded. Clearing is cheap: device lookups re-query, rate windows reset.
const MAP_CAP = 20_000;

async function resolveDevice(ip: string): Promise<{ deviceId: string; hostname: string }> {
  const hit = deviceCache.get(ip);
  if (hit && Date.now() - hit.ts < DEVICE_TTL_MS) return hit;
  if (deviceCache.size > MAP_CAP) deviceCache.clear();
  let deviceId = '', hostname = ip;
  try {
    const { rows } = await query(
      // host() strips any CIDR prefix so a device stored as 192.168.10.100/24
      // still matches a syslog source IP of 192.168.10.100.
      'SELECT id, hostname FROM devices WHERE host(mgmt_ip) = $1 LIMIT 1', [ip]);
    if (rows[0]) { deviceId = rows[0].id; hostname = rows[0].hostname || ip; }
  } catch { /* db unavailable - treat as unknown */ }
  deviceCache.set(ip, { deviceId, hostname, ts: Date.now() });
  return { deviceId, hostname };
}

// Per-source flood guard: cap how many messages each IP can persist per second
// so a single chatty/hostile source can't hammer the DB. Overflow is dropped
// (logging is best-effort) but cheap in-memory alert matching still runs.
const MAX_MSGS_PER_SOURCE_PER_SEC = 50;
const sourceRate = new Map<string, { count: number; windowSec: number }>();

/** Exported for testing; nowSec is injectable for determinism. */
export function withinRate(ip: string, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (sourceRate.size > MAP_CAP) sourceRate.clear();
  const r = sourceRate.get(ip);
  if (!r || r.windowSec !== nowSec) { sourceRate.set(ip, { count: 1, windowSec: nowSec }); return true; }
  if (r.count >= MAX_MSGS_PER_SOURCE_PER_SEC) return false;
  r.count++;
  return true;
}

export function startSyslogListener(): void {
  const port = config.syslogPort;
  const sock = dgram.createSocket('udp4');

  sock.on('message', async (msg, rinfo) => {
    let text = msg.toString('utf8').slice(0, 1024);
    const sourceIp = rinfo.address;

    // RFC 3164/5424 priority prefix: <PRI> where severity = PRI % 8, facility = PRI / 8
    let severity: number | null = null;
    let facility: number | null = null;
    const pri = text.match(/^<(\d+)>/);
    if (pri) {
      const p = parseInt(pri[1], 10);
      severity = p % 8;
      facility = p >> 3;
      text = text.slice(pri[0].length).trim();
    }

    const { deviceId, hostname } = await resolveDevice(sourceIp);

    // Store for the log viewer (best-effort, rate-limited per source)
    if (withinRate(sourceIp)) {
      await query(
        `INSERT INTO syslog_messages (device_id, source_ip, facility, severity, message)
         VALUES ($1,$2,$3,$4,$5)`,
        [deviceId || null, sourceIp, facility, severity, text]
      ).catch(() => { /* viewer storage is non-critical */ });
    }

    for (const { re, handler } of PATTERNS) {
      const m = text.match(re);
      if (!m) continue;
      try {
        await handler(m, deviceId, hostname, text);
      } catch (err) {
        console.warn(`syslog handler error: ${(err as Error).message}`);
      }
      break;
    }
  });

  sock.on('error', err => {
    if ((err as NodeJS.ErrnoException).code === 'EACCES') {
      console.warn(`syslog: cannot bind UDP ${port} — permission denied. Set SYSLOG_PORT to a port > 1024 or run with CAP_NET_BIND_SERVICE.`);
    } else {
      console.warn(`syslog listener error: ${err.message}`);
    }
    sock.close();
  });

  sock.bind(port, () => {
    console.log(`syslog listener on UDP ${port}`);
  });

  // Retention: purge messages older than 14 days, hourly
  setInterval(() => {
    query(`DELETE FROM syslog_messages WHERE received_at < now() - interval '14 days'`)
      .catch(() => { /* retry next hour */ });
  }, 3600_000).unref();
}
