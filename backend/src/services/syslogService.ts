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

export function startSyslogListener(): void {
  const port = config.syslogPort;
  const sock = dgram.createSocket('udp4');

  sock.on('message', async (msg, rinfo) => {
    const text = msg.toString('utf8').slice(0, 1024);
    const sourceIp = rinfo.address;

    // Look up the device by its management IP
    let deviceId = '';
    let hostname = sourceIp;
    try {
      const { rows } = await query(
        'SELECT id, hostname, mgmt_ip FROM devices WHERE mgmt_ip::text = $1 LIMIT 1', [sourceIp]);
      if (rows[0]) { deviceId = rows[0].id; hostname = rows[0].hostname || sourceIp; }
    } catch { /* db unavailable — skip */ }

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
}
