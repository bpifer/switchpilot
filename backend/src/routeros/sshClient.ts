// MikroTik RouterOS SSH session. Unlike IOS (which needs a shell channel for
// enable/config/paging), RouterOS runs cleanly over per-command exec channels:
// each command returns its full output with no pager and no prompt to strip.
// Config commands are stateless absolute paths (/interface set ...), so a fresh
// exec channel per line is correct. vendor: mikrotik.
import { Client } from 'ssh2';
import type { SshTarget } from '../cisco/sshClient.js';
import { buildSshVerification } from '../cisco/hostKey.js';

// RouterOS prints these when it rejects input; surface them as errors so a bad
// config push fails loudly instead of silently.
const ROS_ERROR = /(^|\n)\s*(failure:|bad command name|syntax error|expected end of command|no such item|input does not match)/i;

export class RouterOsSshSession {
  private conn = new Client();

  constructor(private target: SshTarget) {}

  async connect(): Promise<void> {
    const t = this.target;
    const { hostVerifier, rejectionError } = buildSshVerification(t);
    await new Promise<void>((resolve, reject) => {
      this.conn
        .on('ready', resolve)
        .on('error', err => reject(rejectionError() ?? err))
        .connect({
          host: t.host,
          port: t.port ?? 22,
          username: t.username,
          password: t.password,
          readyTimeout: t.timeoutMs ?? 15000,
          hostVerifier,
          // RouterOS 7 negotiates modern kex/ciphers; let ssh2 pick defaults.
        });
    });
  }

  /** Run one command over its own exec channel and return combined output. */
  exec(command: string, timeoutMs = 30000): Promise<string> {
    // Embedded newlines would split into extra RouterOS commands - strip them so
    // user input (e.g. an interface comment) can't inject commands.
    command = command.replace(/[\r\n]+/g, ' ');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`RouterOS command timed out: ${command}`)), timeoutMs);
      this.conn.exec(command, (err, channel) => {
        if (err) { clearTimeout(timer); return reject(err); }
        let out = '';
        channel.on('data', (d: Buffer) => { out += d.toString('utf8'); });
        channel.stderr.on('data', (d: Buffer) => { out += d.toString('utf8'); });
        channel.on('close', () => { clearTimeout(timer); resolve(out.replace(/\r/g, '').trim()); });
      });
    });
  }

  /** Apply config lines. Each is an absolute RouterOS command; a rejection
   *  (failure:/syntax error/...) throws so the job is marked failed. */
  async configure(lines: string[], timeoutMs = 60000): Promise<string> {
    const outputs: string[] = [];
    for (const line of lines) {
      const cmd = line.trim();
      if (!cmd || cmd.startsWith('#')) continue;
      const out = await this.exec(cmd, timeoutMs);
      outputs.push(out);
      if (ROS_ERROR.test(out)) throw new Error(`RouterOS rejected "${cmd}": ${out.trim()}`);
    }
    return outputs.filter(Boolean).join('\n');
  }

  /** RouterOS persists config automatically; nothing to save. */
  async saveConfig(): Promise<string> { return ''; }

  close(): void { this.conn.end(); }
}

/** Convenience: open session, run read commands, close. Mirrors runCommands. */
export async function runRouterOsCommands(target: SshTarget, commands: string[]): Promise<Record<string, string>> {
  const session = new RouterOsSshSession(target);
  const results: Record<string, string> = {};
  await session.connect();
  try {
    for (const cmd of commands) results[cmd] = await session.exec(cmd);
  } finally {
    session.close();
  }
  return results;
}
