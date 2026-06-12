import { describe, it, expect, afterEach } from 'vitest';
import { withDeviceSession, evictDevice, poolSize } from '../src/cisco/sshPool.js';
import { startMockDevice, type RunningMock } from './helpers/mockCiscoDevice.js';
import * as fx from './fixtures/cisco.js';

// The pool's contract: one session per device reused across calls, concurrent
// calls against the same device serialized (stateful shell channel), errors
// evict so the next call reconnects rather than reusing a wedged shell.

let device: RunningMock;
afterEach(async () => {
  if (device) {
    evictDevice({ host: '127.0.0.1', port: device.port, username: 'admin', password: 'x' });
    await device.close();
  }
});

const target = () => ({ host: '127.0.0.1', port: device.port, username: 'admin', password: 'x' });

describe('SSH session pool', () => {
  it('reuses one connection across sequential operations', async () => {
    device = await startMockDevice({ responses: { 'show version': fx.SHOW_VERSION_IOSXE } });

    const a = await withDeviceSession(target(), s => s.exec('show version'));
    const b = await withDeviceSession(target(), s => s.exec('show version'));

    expect(a).toContain('C9300-48P');
    expect(b).toContain('C9300-48P');
    expect(device.connectionCount()).toBe(1);   // second call reused the session
    expect(poolSize()).toBe(1);
  }, 20000);

  it('serializes concurrent operations against the same device', async () => {
    device = await startMockDevice({ responses: { 'show version': fx.SHOW_VERSION_IOSXE } });

    const order: string[] = [];
    await Promise.all([
      withDeviceSession(target(), async s => {
        order.push('a-start');
        await s.exec('show version');
        order.push('a-end');
      }),
      withDeviceSession(target(), async s => {
        order.push('b-start');
        await s.exec('show version');
        order.push('b-end');
      })
    ]);

    // b must not start until a finished - interleaving would corrupt the shell
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
    expect(device.connectionCount()).toBe(1);   // and both shared one connect
  }, 20000);

  it('evicts the session when an operation fails, reconnecting on the next call', async () => {
    device = await startMockDevice({ responses: { 'show version': fx.SHOW_VERSION_IOSXE } });

    await expect(
      withDeviceSession(target(), async () => { throw new Error('boom'); })
    ).rejects.toThrow('boom');
    expect(poolSize()).toBe(0);

    // next call gets a fresh connection and works
    const out = await withDeviceSession(target(), s => s.exec('show version'));
    expect(out).toContain('C9300-48P');
    expect(device.connectionCount()).toBe(2);
  }, 20000);

  it('a failed operation queued behind a successful one does not break the chain', async () => {
    device = await startMockDevice({ responses: { 'show version': fx.SHOW_VERSION_IOSXE } });

    const results = await Promise.allSettled([
      withDeviceSession(target(), s => s.exec('show version')),
      withDeviceSession(target(), async () => { throw new Error('mid-chain failure'); }),
      withDeviceSession(target(), s => s.exec('show version'))
    ]);

    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    expect(results[2].status).toBe('fulfilled');   // chain survived the failure
  }, 20000);

  it('evictDevice closes and removes the pooled session', async () => {
    device = await startMockDevice({ responses: { 'show version': fx.SHOW_VERSION_IOSXE } });

    await withDeviceSession(target(), s => s.exec('show version'));
    expect(poolSize()).toBe(1);

    evictDevice(target());
    expect(poolSize()).toBe(0);

    await withDeviceSession(target(), s => s.exec('show version'));
    expect(device.connectionCount()).toBe(2);
  }, 20000);
});
