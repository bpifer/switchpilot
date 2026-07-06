// A minimal fake Cisco IOS SSH device for headless testing of CiscoSshSession.
// Speaks just enough of the CLI: a shell channel, a moving prompt (>, #, (config)#),
// enable mode, config mode, paging-free `terminal length 0`, and canned `show` output.
import { Server } from 'ssh2';
import { generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';

export interface MockDeviceOptions {
  hostname?: string;
  /** command (exact, trimmed) → output text */
  responses?: Record<string, string>;
  /** config lines containing any of these substrings are rejected with an IOS error */
  rejectConfigContaining?: string[];
  /** Fault injection (chaos tests): reject SSH authentication outright. */
  rejectAuth?: boolean;
  /** Fault injection: when this exact command arrives, drop the shell channel
   *  mid-command (simulates a device disconnect / TCP reset during an op). */
  dropOnCommand?: string;
  /** Fault injection: delay every command's response by this many ms (to
   *  exercise per-exec timeouts). */
  delayMs?: number;
  /** When set, `enable` prompts for a password ("Password: ") and only grants
   *  privileged mode if the next line matches. Exercises CiscoSshSession.enable()'s
   *  interactive prompt handling (real IOS behaviour). */
  enablePassword?: string;
  /** Echo each typed command back (as its own write, before the output) the way
   *  a real device's shell does. Exercises exec()'s command-echo stripping when
   *  the echo and the output arrive in separate chunks. */
  echoCommands?: boolean;
  /** Multi-page `show` output gated behind `--More--`: the device sends one page
   *  at a time and advances only when the client sends the space paging key.
   *  command (exact, trimmed) → ordered pages. */
  pagedResponses?: Record<string, string[]>;
}

export interface RunningMock {
  port: number;
  close: () => Promise<void>;
  /** Number of SSH connections accepted since start (for pool reuse tests). */
  connectionCount: () => number;
}

function hostKey(): string {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' }
  });
  return privateKey;
}

export async function startMockDevice(opts: MockDeviceOptions = {}): Promise<RunningMock> {
  const hostname = opts.hostname ?? 'core-sw-01';
  const responses = opts.responses ?? {};
  const reject = opts.rejectConfigContaining ?? [];

  let connections = 0;
  const server = new Server({
    hostKeys: [hostKey()],
    // The real CiscoSshSession offers legacy + modern kex; pin the server to
    // algorithms ssh2 can actually serve (group-exchange is client-only in ssh2)
    // so negotiation lands on ecdh/curve25519 instead of failing the handshake.
    algorithms: {
      kex: ['curve25519-sha256', 'ecdh-sha2-nistp256', 'diffie-hellman-group14-sha256', 'diffie-hellman-group14-sha1']
    }
  }, client => {
    connections++;
    // A client may abort mid-handshake (e.g. host-key verification rejects the
    // server before auth); without a handler ssh2 surfaces that as an unhandled
    // 'error'. The mock doesn't care why a connection dropped.
    client.on('error', () => { /* client disconnected */ });
    client.on('authentication', ctx => opts.rejectAuth ? ctx.reject() : ctx.accept());
    client.on('ready', () => {
      client.on('session', accept => {
        const session = accept();
        // ssh2 session requests pass (accept, reject, info) — accept is first.
        session.on('pty', accept => accept && accept());
        session.on('shell', accept => {
          const stream = accept();
          let mode: 'exec' | 'config' = 'exec';
          let priv = false;
          let buf = '';
          let awaitingEnablePw = false;
          // When a paged response is in flight, the remaining pages plus the
          // space-key handler live here; the raw-data path drains it.
          let pending: { pages: string[] } | null = null;

          const prompt = () => `${hostname}${mode === 'config' ? '(config)' : ''}${priv ? '#' : '>'}`;
          const send = (output: string) => stream.write((output ? output + '\r\n' : '') + prompt());

          // Send one page of a `--More--` response; the last page ends at the prompt.
          function sendPage() {
            if (!pending) return;
            const page = pending.pages.shift()!;
            if (pending.pages.length > 0) {
              stream.write(page + '\r\n --More-- ');
            } else {
              pending = null;
              send(page);
            }
          }

          // initial banner + prompt
          stream.write(`\r\n${prompt()}`);

          stream.on('data', (d: Buffer) => {
            const chunk = d.toString('utf8');
            // While paging, the client advances with a bare space (no newline).
            if (pending) { if (chunk.includes(' ')) sendPage(); return; }
            buf += chunk;
            let nl: number;
            while ((nl = buf.indexOf('\n')) !== -1) {
              const line = buf.slice(0, nl).replace(/\r$/, '').trim();
              buf = buf.slice(nl + 1);
              handle(line);
            }
          });

          function handle(cmd: string) {
            // Fault injection: drop the shell mid-command instead of replying.
            if (opts.dropOnCommand && cmd === opts.dropOnCommand) { stream.end(); return; }
            // Interactive enable-password step: the previous line was `enable`.
            if (awaitingEnablePw) {
              awaitingEnablePw = false;
              if (cmd === opts.enablePassword) { priv = true; send(''); }
              else { stream.write('% Access denied\r\n'); send(''); }   // stays unprivileged
              return;
            }
            // Real shells echo the typed command back before answering; send it
            // as its own write so echo and output land in separate chunks.
            if (opts.echoCommands && cmd !== '') stream.write(cmd + '\r\n');
            if (cmd === '') { send(''); return; }
            if (cmd === 'enable') {
              if (opts.enablePassword) { awaitingEnablePw = true; stream.write('Password: '); return; }
              priv = true; send(''); return;
            }
            if (cmd === 'disable') { priv = false; send(''); return; }
            if (/^terminal /.test(cmd)) { send(''); return; }
            if (cmd === 'configure terminal' || cmd === 'conf t') { mode = 'config'; send(''); return; }
            if (cmd === 'end') { mode = 'exec'; send(''); return; }
            if (cmd === 'exit') {
              if (mode === 'config') { mode = 'exec'; send(''); }
              else { stream.end(); }
              return;
            }
            if (/^(write memory|copy running-config startup-config)/.test(cmd)) { send('[OK]'); return; }

            if (mode === 'config') {
              if (reject.some(r => cmd.includes(r))) { send('% Invalid input detected at \'^\' marker.'); return; }
              send(''); // accept the config line silently
              return;
            }
            // Multi-page output gated behind --More--: kick off the first page;
            // the client's space keys drain the rest via sendPage().
            const paged = opts.pagedResponses?.[cmd];
            if (paged && paged.length) { pending = { pages: [...paged] }; sendPage(); return; }
            // exec mode: canned show output (empty for unknown commands). Only
            // the show response honors delayMs, so connect-time setup commands
            // (terminal/enable) aren't slowed - the delay targets exec timeouts.
            if (opts.delayMs) setTimeout(() => send(responses[cmd] ?? ''), opts.delayMs);
            else send(responses[cmd] ?? '');
          }
        });
      });
    });
  });

  const port: number = await new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });

  return {
    port,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
    connectionCount: () => connections
  };
}
