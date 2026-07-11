import { describe, it, expect, afterEach, vi } from 'vitest';

// Cross-replica lock coverage for the SSH pool. Redis is mocked with an
// in-memory SET NX / compare-and-delete so we can assert the lock is taken and
// released around each session op, that same-process calls still serialize
// (taking the lock in turn, no deadlock), and that a not-ready Redis degrades
// to a no-op. The real cross-replica wait path isn't unit-tested (it needs two
// processes); its correctness rests on the standard SET NX EX + Lua release.
const h = vi.hoisted(() => ({
  store: new Map<string, string>(),
  calls: { set: 0, eval: 0 },
  state: { status: 'ready' as string },
}));

vi.mock('../src/redis.js', () => ({
  redis: {
    get status() { return h.state.status; },
    async set(key: string, val: string, _px: string, _ttl: number, nx?: string) {
      h.calls.set++;
      if (nx === 'NX' && h.store.has(key)) return null;
      h.store.set(key, val);
      return 'OK';
    },
    async eval(_lua: string, _n: number, key: string, token: string) {
      h.calls.eval++;
      if (h.store.get(key) === token) { h.store.delete(key); return 1; }
      return 0;
    },
  },
}));

import { withDeviceSession, evictDevice, poolSize } from '../src/cisco/sshPool.js';
import { startMockDevice, type RunningMock } from './helpers/mockCiscoDevice.js';
import * as fx from './fixtures/cisco.js';

let device: RunningMock;
const target = () => ({ host: '127.0.0.1', port: device.port, username: 'admin', password: 'x' });

afterEach(async () => {
  if (device) { evictDevice(target()); await device.close(); }
  h.state.status = 'ready';
  h.store.clear();
  h.calls.set = 0;
  h.calls.eval = 0;
});

describe('SSH pool cross-replica lock', () => {
  it('acquires and releases the Redis lock around each op when Redis is ready', async () => {
    device = await startMockDevice({ responses: { 'show version': fx.SHOW_VERSION_IOSXE } });
    const out = await withDeviceSession(target(), s => s.exec('show version'));
    expect(out).toContain('C9300-48P');
    expect(h.calls.set).toBe(1);    // lock acquired once
    expect(h.calls.eval).toBe(1);   // and released once
    expect(h.store.size).toBe(0);   // nothing left locked
  }, 20000);

  it('serializes same-process calls and takes the lock in turn (no deadlock)', async () => {
    device = await startMockDevice({ responses: { 'show version': fx.SHOW_VERSION_IOSXE } });
    const order: string[] = [];
    await Promise.all([
      withDeviceSession(target(), async s => { order.push('a-start'); await s.exec('show version'); order.push('a-end'); }),
      withDeviceSession(target(), async s => { order.push('b-start'); await s.exec('show version'); order.push('b-end'); }),
    ]);
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
    expect(h.calls.set).toBe(2);    // each op took the lock in its turn
    expect(h.calls.eval).toBe(2);   // and both released
    expect(device.connectionCount()).toBe(1);   // still one shared connection
  }, 20000);

  it('degrades to a no-op when Redis is not ready', async () => {
    h.state.status = 'end';
    device = await startMockDevice({ responses: { 'show version': fx.SHOW_VERSION_IOSXE } });
    const out = await withDeviceSession(target(), s => s.exec('show version'));
    expect(out).toContain('C9300-48P');
    expect(h.calls.set).toBe(0);    // Redis never touched
    expect(poolSize()).toBe(1);     // pool still works
  }, 20000);
});
