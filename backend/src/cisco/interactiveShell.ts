// Raw interactive SSH shell for the browser terminal. Unlike CiscoSshSession
// (which buffers output and auto-pages for command exec), this pipes the shell
// stream straight through so the operator drives the CLI directly.
import { Client } from 'ssh2';
import { SSH_ALGORITHMS, type SshTarget } from './sshClient.js';

export interface ShellHandle {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

export function openInteractiveShell(
  target: SshTarget,
  onData: (chunk: string) => void,
  onClose: () => void
): Promise<ShellHandle> {
  const conn = new Client();
  return new Promise((resolve, reject) => {
    conn
      .on('ready', () => {
        conn.shell({ term: 'xterm-256color', cols: 120, rows: 30 }, (err, stream) => {
          if (err) { conn.end(); return reject(err); }
          stream.on('data', (d: Buffer) => onData(d.toString('utf8')));
          stream.stderr?.on('data', (d: Buffer) => onData(d.toString('utf8')));
          stream.on('close', () => { conn.end(); onClose(); });
          resolve({
            write: (data) => { try { stream.write(data); } catch { /* closed */ } },
            resize: (cols, rows) => { try { stream.setWindow(rows, cols, 0, 0); } catch { /* closed */ } },
            close: () => { try { conn.end(); } catch { /* already closed */ } }
          });
        });
      })
      .on('error', err => reject(err))
      .connect({
        host: target.host,
        port: target.port ?? 22,
        username: target.username,
        password: target.password,
        readyTimeout: 15000,
        algorithms: SSH_ALGORITHMS
      });
  });
}
