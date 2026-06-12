import { Client, type ClientChannel } from 'ssh2';

export interface SshTarget {
  host: string;
  username: string;
  password: string;
  enablePassword?: string;
  port?: number;
  timeoutMs?: number;
  /** Skip the enable step — NX-OS SSH sessions land directly at privilege level 15. */
  skipEnable?: boolean;
}

const PROMPT = /[\w\-./:()]+[#>]\s?$/m;
const MORE = /--More--/;

/**
 * Interactive SSH session against a Cisco IOS/IOS-XE device.
 * Uses a shell channel (not exec) because many IOS images restrict exec channels,
 * and we need enable mode + config mode in one session.
 */
export class CiscoSshSession {
  private conn = new Client();
  private stream!: ClientChannel;
  private buffer = '';

  constructor(private target: SshTarget) {}

  async connect(): Promise<void> {
    const t = this.target;
    await new Promise<void>((resolve, reject) => {
      this.conn
        .on('ready', resolve)
        .on('error', reject)
        .connect({
          host: t.host,
          port: t.port ?? 22,
          username: t.username,
          password: t.password,
          readyTimeout: t.timeoutMs ?? 15000,
          // Older IOS only offers legacy kex/ciphers; allow them explicitly.
          algorithms: {
            kex: ['diffie-hellman-group14-sha1', 'diffie-hellman-group1-sha1',
                  'diffie-hellman-group-exchange-sha256', 'ecdh-sha2-nistp256',
                  'diffie-hellman-group14-sha256', 'curve25519-sha256'] as any,
            cipher: ['aes128-cbc', 'aes256-cbc', '3des-cbc',
                     'aes128-ctr', 'aes192-ctr', 'aes256-ctr',
                     'aes128-gcm@openssh.com', 'aes256-gcm@openssh.com'] as any
          }
        });
    });
    this.stream = await new Promise<ClientChannel>((resolve, reject) => {
      this.conn.shell({ term: 'vt100', rows: 512, cols: 511 }, (err, stream) =>
        err ? reject(err) : resolve(stream));
    });
    this.stream.on('data', (d: Buffer) => {
      this.buffer += d.toString('utf8');
      // auto-page through --More-- prompts
      if (MORE.test(this.buffer)) {
        this.buffer = this.buffer.replace(/--More--\s*/g, '');
        this.stream.write(' ');
      }
    });
    await this.waitForPrompt();
    await this.exec('terminal length 0');
    await this.exec('terminal width 511');
  }

  /** Enter privileged EXEC mode if needed. */
  async enable(): Promise<void> {
    this.buffer = '';
    this.stream.write('enable\n');
    const out = await this.waitFor(/[Pp]assword:|#\s?$/m);
    if (/[Pp]assword:/.test(out)) {
      this.stream.write((this.target.enablePassword ?? this.target.password) + '\n');
      await this.waitForPrompt();
    }
  }

  /** Run a single command and return its output (without the echoed command/prompt). */
  async exec(command: string, timeoutMs = 30000): Promise<string> {
    this.buffer = '';
    this.stream.write(command + '\n');
    const raw = await this.waitForPrompt(timeoutMs);
    return raw
      .split('\n')
      .filter(l => !l.trim().startsWith(command.trim().slice(0, 60)))
      .join('\n')
      .replace(PROMPT, '')
      .trim();
  }

  /** Apply configuration lines inside config terminal mode, then exit. */
  async configure(lines: string[], timeoutMs = 60000): Promise<string> {
    const outputs: string[] = [];
    outputs.push(await this.exec('configure terminal'));
    for (const line of lines) {
      if (!line.trim() || line.trim().startsWith('!')) continue;
      const out = await this.exec(line, timeoutMs);
      outputs.push(out);
      if (/% (Invalid|Incomplete|Ambiguous|Error)/i.test(out)) {
        await this.exec('end');
        throw new Error(`Configuration rejected at "${line}": ${out.trim()}`);
      }
    }
    outputs.push(await this.exec('end'));
    return outputs.filter(Boolean).join('\n');
  }

  async saveConfig(cmd = 'write memory'): Promise<string> {
    this.buffer = '';
    this.stream.write(cmd + '\n');
    // IOS returns "[OK]", NX-OS returns "Copy complete."
    const out = await this.waitFor(/\[OK\]|Copy complete|#\s?$/m, 60000);
    return out;
  }

  /**
   * Issue `reload` and answer its interactive prompts:
   *   "System configuration has been modified. Save? [yes/no]:" -> no (caller saved already)
   *   "Proceed with reload? [confirm]" -> newline
   * Resolves when the connection drops (the reload taking effect) or after timeout.
   */
  reload(timeoutMs = 30000): Promise<string> {
    this.buffer = '';
    this.stream.write('reload\n');
    return new Promise(resolve => {
      const started = Date.now();
      const tick = setInterval(() => {
        if (/\[yes\/no\]:?\s*$/i.test(this.buffer)) {
          this.buffer = '';
          this.stream.write('no\n');
        } else if (/\[confirm\]\s*$/i.test(this.buffer)) {
          this.buffer = '';
          this.stream.write('\n');
        } else if (Date.now() - started > timeoutMs) {
          clearInterval(tick);
          resolve('reload issued (no disconnect observed within timeout)');
        }
      }, 100);
      const done = (why: string) => { clearInterval(tick); resolve(`reload issued; ${why}`); };
      this.stream.once('close', () => done('device dropped the session (rebooting)'));
      this.conn.once('close', () => done('connection closed (rebooting)'));
      this.conn.once('error', () => done('connection reset (rebooting)'));
    });
  }

  close(): void {
    try { this.stream?.end('exit\n'); } catch { /* already closed */ }
    this.conn.end();
  }

  private waitForPrompt(timeoutMs = 30000): Promise<string> {
    return this.waitFor(PROMPT, timeoutMs);
  }

  private waitFor(pattern: RegExp, timeoutMs = 30000): Promise<string> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = setInterval(() => {
        if (pattern.test(this.buffer)) {
          clearInterval(tick);
          const out = this.buffer;
          this.buffer = '';
          resolve(out);
        } else if (Date.now() - started > timeoutMs) {
          clearInterval(tick);
          reject(new Error(`Timed out waiting for device prompt (last output: ${this.buffer.slice(-200)})`));
        }
      }, 50);
    });
  }
}

/** Convenience: open session, run commands in enable mode, close. */
export async function runCommands(target: SshTarget, commands: string[]): Promise<Record<string, string>> {
  const session = new CiscoSshSession(target);
  const results: Record<string, string> = {};
  await session.connect();
  try {
    if (!target.skipEnable) await session.enable();
    for (const cmd of commands) results[cmd] = await session.exec(cmd);
  } finally {
    session.close();
  }
  return results;
}
