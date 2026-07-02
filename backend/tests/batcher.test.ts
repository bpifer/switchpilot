import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBatcher } from '../src/util/batcher.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createBatcher (buffered telemetry writes)', () => {
  it('flushes on the interval with everything queued so far', async () => {
    const flush = vi.fn(async () => {});
    const b = createBatcher<number>({ intervalMs: 1000, maxBatch: 100, maxBuffer: 1000, flush });
    b.push(1); b.push(2); b.push(3);
    expect(flush).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith([1, 2, 3]);
    expect(b.size()).toBe(0);
    b.stop();
  });

  it('flushes immediately when the batch size is reached, without waiting', async () => {
    const flush = vi.fn(async () => {});
    const b = createBatcher<number>({ intervalMs: 60_000, maxBatch: 3, maxBuffer: 1000, flush });
    b.push(1); b.push(2);
    expect(flush).not.toHaveBeenCalled();
    b.push(3);
    await vi.advanceTimersByTimeAsync(0);   // let the microtask run
    expect(flush).toHaveBeenCalledWith([1, 2, 3]);
    b.stop();
  });

  it('an empty interval tick does not call flush', async () => {
    const flush = vi.fn(async () => {});
    const b = createBatcher<number>({ intervalMs: 500, maxBatch: 10, maxBuffer: 100, flush });
    await vi.advanceTimersByTimeAsync(2000);
    expect(flush).not.toHaveBeenCalled();
    b.stop();
  });

  it('sheds load above maxBuffer instead of growing memory', async () => {
    const flush = vi.fn(async () => {});
    const b = createBatcher<number>({ intervalMs: 60_000, maxBatch: 100, maxBuffer: 5, flush });
    for (let i = 0; i < 20; i++) b.push(i);
    expect(b.size()).toBe(5);
    await b.flushNow();
    expect(flush).toHaveBeenCalledWith([0, 1, 2, 3, 4]);
    b.stop();
  });

  it('a failed flush drops its batch (no retry storm) and reports the count', async () => {
    const onError = vi.fn();
    const flush = vi.fn(async () => { throw new Error('db down'); });
    const b = createBatcher<number>({ intervalMs: 60_000, maxBatch: 100, maxBuffer: 100, flush, onError });
    b.push(1); b.push(2);
    await b.flushNow();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'db down' }), 2);
    expect(b.size()).toBe(0);   // nothing re-queued

    // subsequent pushes still work
    b.push(3);
    flush.mockImplementation(async () => {});
    await b.flushNow();
    expect(flush).toHaveBeenLastCalledWith([3]);
    b.stop();
  });

  it('only one flush runs at a time; items pushed mid-flush go to the next batch', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const batches: number[][] = [];
    const flush = vi.fn(async (items: number[]) => { batches.push(items); await gate; });
    const b = createBatcher<number>({ intervalMs: 60_000, maxBatch: 2, maxBuffer: 100, flush });

    b.push(1); b.push(2);          // triggers flush #1 (blocked on the gate)
    await vi.advanceTimersByTimeAsync(0);
    b.push(3); b.push(4);          // size trigger fires but flush #1 is in flight
    await vi.advanceTimersByTimeAsync(0);
    expect(flush).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(0);
    await b.flushNow();
    expect(batches).toEqual([[1, 2], [3, 4]]);
    b.stop();
  });
});
