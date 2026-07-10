import { Client, type ClientChannel } from 'ssh2';
import { buildSshVerification } from './hostKey.js';

export interface SshTarget {
  host: string;
  username: string;
  password: string;
  enablePassword?: string;
  port?: number;
  timeoutMs?: number;
  /** Skip the enable step — NX-OS SSH sessions land directly at privilege level 15. */
  skipEnable?: boolean;
  /** Device OS, so the pool opens the right session class ('routeros' -> MikroTik). */
  os?: string;
  /** ssh2 host-key verifier (see hostKey.ts). When set, the session pins/verifies
   *  the device's SSH host key and refuses a changed key before authenticating.
   *  Absent => no host-key checking (ssh2's prior behavior), e.g. onboarding probes. */
  hostVerifier?: (key: Buffer) => boolean;
}

/** The session surface the pool and deviceComms rely on; both the Cisco shell
 *  session and the RouterOS exec session implement it. */
export interface DeviceSession {
  connect(): Promise<void>;
  exec(command: string, timeoutMs?: number): Promise<string>;
  /** Optional: collect output from a possibly non-self-terminating command for a
   *  bounded time, then stop. Implemented by the RouterOS exec session for
   *  diagnostic tools like traceroute; absent on the Cisco shell session. */
  execBounded?(command: string, durationMs: number): Promise<string>;
  configure(lines: string[], timeoutMs?: number): Promise<string>;
  saveConfig(cmd?: string): Promise<string>;
  /** Arm a commit-confirm revert timer. Present on Cisco sessions that need
   *  interactive prompt handling for `reload in N`; RouterOS handles this via
   *  driver-generated config lines in armRevertLines() instead. */
  armRevert?(seconds: number): Promise<string>;
  /** Cancel an armed revert and return to the device prompt. Paired with armRevert. */
  disarmRevert?(): Promise<string>;
  close(): void;
}

/** Pure: given the buffered output from the device after `reload in N`, return
 *  the string to send next, or null if no recognized prompt is present yet.
 *  Exported so the state machine can be unit-tested without mocking ssh2. */
export function reloadInResponse(output: string): string | null {
  // Check [yes/no] first -- if both appear (shouldn't in practice) the Save
  // prompt comes before the Proceed prompt and must be answered first.
  if (/\[yes\/no\]/i.test(output)) return 'no\n';
  if (/\[confirm\]/i.test(output)) return '\n';
  return null;
}

const PROMPT = /[\w\-./:()]+[#>]\s?$/m;
const MORE = /--More--/;

// Older IOS only offers legacy kex/ciphers; allow them explicitly. Shared by
// the command session and the interactive terminal shell.
export const SSH_ALGORITHMS = {
  kex: ['diffie-hellman-group14-sha1', 'diffie-hellman-group1-sha1',
        'diffie-hellman-group-exchange-sha256', 'ecdh-sha2-nistp256',
        'diffie-hellman-group14-sha256', 'curve25519-sha256'] as any,
  cipher: ['aes128-cbc', 'aes256-cbc', '3des-cbc',
           'aes128-ctr', 'aes192-ctr', 'aes256-ctr',
           'aes128-gcm@openssh.com', 'aes256-gcm@openssh.com'] as any
};

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
    const { hostVerifier, rejectionError } = buildSshVerification(t);
    await new Promise<void>((resolve, reject) => {
      this.conn
        .on('ready', resolve)
        // Prefer the host-key error (clear + actionable) over ssh2's opaque one.
        .on('error', err => reject(rejectionError() ?? err))
        .connect({
          host: t.host,
          port: t.port ?? 22,
          username: t.username,
          password: t.password,
          readyTimeout: t.timeoutMs ?? 15000,
          algorithms: SSH_ALGORITHMS,
          hostVerifier
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

  /** Enter privileged EXEC mode. Throws when the device refuses elevation -
   *  a `>` prompt after the attempt means the enable password was wrong or
   *  missing, and silently continuing at privilege 1 would surface later as
   *  baffling "% Invalid input" on ordinary reads (seen live on a 2960X whose
   *  account was priv-1). */
  async enable(): Promise<void> {
    this.buffer = '';
    this.stream.write('enable\n');
    const out = await this.waitFor(/[Pp]assword:|[#>]\s?$/m);
    if (/#\s?$/m.test(out)) return;   // elevated (or was already privileged)
    if (/[Pp]assword:/.test(out)) {
      this.stream.write((this.target.enablePassword ?? this.target.password) + '\n');
      const res = await this.waitFor(/[Pp]assword:|[#>]\s?$/m);
      if (/#\s?$/m.test(res)) return;
    }
    // Re-prompted for a password or dumped back at '>' - elevation failed.
    throw new Error(
      'Privilege elevation failed: the switch did not grant enable mode. ' +
      'Set the correct enable password on the credential profile, or use a privilege-15 account.');
  }

  /** Run a single command and return its output (without the echoed command/prompt). */
  async exec(command: string, timeoutMs = 30000): Promise<string> {
    // A single command must never contain an embedded newline - that would let
    // user input (e.g. a port description) inject additional CLI commands.
    command = command.replace(/[\r\n]+/g, ' ');
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

  /** Issue `reload in N` and answer its interactive prompts to arm a scheduled
   *  revert, leaving startup-config unchanged (it is the rollback point).
   *  The session stays alive; the reload fires only if disarmRevert is never
   *  called before the timer expires.
   *
   *  Prompt sequence (validated on C9300 IOS-XE 17.3):
   *    [optional] "Save? [yes/no]:"  -> "no"  (skip if running == startup)
   *               "Proceed? [confirm]" -> Enter */
  async armRevert(seconds: number): Promise<string> {
    const minutes = Math.max(1, Math.ceil(seconds / 60));
    this.buffer = '';
    this.stream.write(`reload in ${minutes}\n`);
    // Wait for the first interactive prompt. If config is already in sync with
    // startup the Save? step is skipped and [confirm] appears immediately.
    const first = await this.waitFor(/\[yes\/no\]|\[confirm\]/i, 15000);
    if (/\[yes\/no\]/i.test(first)) {
      this.buffer = '';
      this.stream.write('no\n');
      await this.waitFor(/\[confirm\]/i, 10000);
    }
    this.buffer = '';
    this.stream.write('\n');
    return this.waitForPrompt(15000);
  }

  /** Cancel the scheduled reload armed by armRevert. Call this after confirming
   *  the device is still reachable; follow with saveConfig to persist the change. */
  async disarmRevert(): Promise<string> {
    return this.exec('reload cancel');
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
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearInterval(tick);
        this.stream?.removeListener('close', onClose);
        this.conn.removeListener('close', onClose);
        this.conn.removeListener('error', onClose);
        fn();
      };
      // A mid-command disconnect (device dropped the shell, TCP reset) must fail
      // fast so the pool evicts and reconnects - not hang until timeoutMs. The
      // reload() path handles its own close separately and doesn't use waitFor.
      const onClose = () => settle(() =>
        reject(new Error(`Device closed the connection mid-command (last output: ${this.buffer.slice(-200)})`)));
      const tick = setInterval(() => {
        if (pattern.test(this.buffer)) {
          const out = this.buffer;
          this.buffer = '';
          settle(() => resolve(out));
        } else if (Date.now() - started > timeoutMs) {
          settle(() => reject(new Error(`Timed out waiting for device prompt (last output: ${this.buffer.slice(-200)})`)));
        }
      }, 50);
      this.stream?.once('close', onClose);
      this.conn.once('close', onClose);
      this.conn.once('error', onClose);
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
