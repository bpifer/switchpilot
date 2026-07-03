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
