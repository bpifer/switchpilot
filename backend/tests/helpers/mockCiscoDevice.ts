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
}

export interface RunningMock {
  port: number;
  close: () => Promise<void>;
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

  const server = new Server({ hostKeys: [hostKey()] }, client => {
    client.on('authentication', ctx => ctx.accept());
    client.on('ready', () => {
      client.on('session', accept => {
        const session = accept();
        session.on('pty', (_a, _r, accept) => accept && accept());
        session.on('shell', accept => {
          const stream = accept();
          let mode: 'exec' | 'config' = 'exec';
          let priv = false;
          let buf = '';

          const prompt = () => `${hostname}${mode === 'config' ? '(config)' : ''}${priv ? '#' : '>'}`;
          const send = (output: string) => stream.write((output ? output + '\r\n' : '') + prompt());

          // initial banner + prompt
          stream.write(`\r\n${prompt()}`);

          stream.on('data', (d: Buffer) => {
            buf += d.toString('utf8');
            let nl: number;
            while ((nl = buf.indexOf('\n')) !== -1) {
              const line = buf.slice(0, nl).replace(/\r$/, '').trim();
              buf = buf.slice(nl + 1);
              handle(line);
            }
          });

          function handle(cmd: string) {
            if (cmd === '') { send(''); return; }
            if (cmd === 'enable') { priv = true; send(''); return; }
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
            // exec mode: canned show output (empty for unknown commands)
            send(responses[cmd] ?? '');
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
    close: () => new Promise<void>(resolve => server.close(() => resolve()))
  };
}
