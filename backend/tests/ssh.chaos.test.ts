import { describe, it, expect, afterEach } from 'vitest';
import { CiscoSshSession } from '../src/cisco/sshClient.js';
import { withDeviceSession, evictDevice, poolSize } from '../src/cisco/sshPool.js';
import { startMockDevice, type RunningMock } from './helpers/mockCiscoDevice.js';
import * as fx from './fixtures/cisco.js';

// Chaos cases the happy-path integration tests don't cover: auth rejection,
// a device that drops the shell mid-command, and a device that stalls past the
// exec timeout. These exercise CiscoSshSession's failure handling (and the
// pool's eviction) without hardware.

let device: RunningMock;
afterEach(async () => {
  if (device) {
    evictDevice({ host: '127.0.0.1', port: device.port, username: 'admin', password: 'x' });
    await device.close();
  }
});

const target = () => ({ host: '127.0.0.1', port: device.port, username: 'admin', password: 'x' });

describe('CiscoSshSession chaos', () => {
  it('rejects connect() when the device refuses authentication', async () => {
    device = await startMockDevice({ rejectAuth: true });
    const session = new CiscoSshSession(target());
    await expect(session.connect()).rejects.toThrow();
    session.close();
  }, 15000);

  it('fails FAST (not after the 30s exec timeout) when the device drops the shell mid-command', async () => {
    device = await startMockDevice({
      responses: { 'show version': fx.SHOW_VERSION_IOSXE },
      dropOnCommand: 'show version',
    });
    const session = new CiscoSshSession(target());
    await session.connect();
    await session.enable();

    const started = Date.now();
    await expect(session.exec('show version')).rejects.toThrow(/closed the connection/i);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(5000);   // proves it didn't wait out the 30s default
    session.close();
  }, 15000);

  it('propagates a mid-command disconnect through the pool as an eviction', async () => {
    device = await startMockDevice({
      responses: { 'show version': fx.SHOW_VERSION_IOSXE },
      dropOnCommand: 'show version',
    });
    await expect(
      withDeviceSession(target(), s => s.exec('show version'))
    ).rejects.toThrow(/closed the connection/i);
    expect(poolSize()).toBe(0);   // the wedged session was evicted, not reused
  }, 15000);

  it('rejects with a timeout when the device stalls past the per-exec deadline', async () => {
    device = await startMockDevice({
      responses: { 'show version': fx.SHOW_VERSION_IOSXE },
      delayMs: 5000,   // device takes 5s to answer
    });
    const session = new CiscoSshSession(target());
    await session.connect();
    await session.enable();

    const started = Date.now();
    // give exec only 300ms; it must time out well before the device's 5s reply
    await expect(session.exec('show version', 300)).rejects.toThrow(/timed out/i);
    expect(Date.now() - started).toBeLessThan(3000);
    session.close();
  }, 15000);
});

// enable() and exec() have to survive the small variations real IOS shells
// throw at them: an interactive enable-password prompt, the device echoing the
// typed command back (sometimes late), and long output paged behind --More--.
describe('CiscoSshSession auth + echo variants', () => {
  const enableTarget = () => ({ ...target(), enablePassword: 'secretEnable' });

  it('answers the enable password prompt and reaches privileged mode', async () => {
    device = await startMockDevice({
      enablePassword: 'secretEnable',
      responses: { 'show running-config': 'hostname core-sw-01\n!' },
    });
    const session = new CiscoSshSession(enableTarget());
    await session.connect();
    await session.enable();   // must send the enable password at "Password:"
    // A privileged command now returns its canned output cleanly.
    expect(await session.exec('show running-config')).toContain('hostname core-sw-01');
    session.close();
  }, 15000);

  it('throws a clear error when the enable password is wrong instead of silently staying at priv 1', async () => {
    device = await startMockDevice({ enablePassword: 'secretEnable' });
    // Target has NO enablePassword, so enable() falls back to the (wrong) login
    // password. Regression: PROMPT matches '>' too, so a rejected elevation used
    // to return successfully and every later privileged op failed confusingly
    // (seen live on a 2960X with a priv-1 account).
    const session = new CiscoSshSession(target());
    await session.connect();
    await expect(session.enable()).rejects.toThrow(/privilege elevation failed/i);
    session.close();
  }, 15000);

  it('connects straight through when the device grants # without a password (skipEnable)', async () => {
    device = await startMockDevice({ responses: { 'show clock': '12:00:00 UTC' } });
    const session = new CiscoSshSession(target());
    await session.connect();
    // No enable() call; exec still works from the unprivileged prompt.
    expect(await session.exec('show clock')).toContain('12:00:00');
    session.close();
  }, 15000);

  it('strips the echoed command when the device echoes it back in a separate chunk', async () => {
    device = await startMockDevice({
      echoCommands: true,
      responses: { 'show version': fx.SHOW_VERSION_IOSXE },
    });
    const session = new CiscoSshSession(target());
    await session.connect();
    await session.enable();
    const out = await session.exec('show version');
    expect(out).toContain('Cisco IOS XE Software');
    // The echoed command line must not survive into the parsed output, and the
    // trailing prompt must be stripped.
    expect(out).not.toMatch(/^show version/m);
    expect(out).not.toMatch(/core-sw-01[#>]\s*$/);
    session.close();
  }, 15000);

  it('pages through --More-- output and returns the whole thing', async () => {
    device = await startMockDevice({
      pagedResponses: {
        'show running-config': ['hostname core-sw-01', 'interface Gi1/0/1', ' description UPLINK', 'end'],
      },
    });
    const session = new CiscoSshSession(target());
    await session.connect();
    await session.enable();
    const out = await session.exec('show running-config');
    // Every page made it through and no --More-- marker leaked into the result.
    expect(out).toContain('hostname core-sw-01');
    expect(out).toContain('description UPLINK');
    expect(out).toContain('end');
    expect(out).not.toContain('More');
    session.close();
  }, 15000);
});
