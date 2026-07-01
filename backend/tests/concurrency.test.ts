import { describe, it, expect } from 'vitest';
import { forEachLimit } from '../src/util/concurrency.js';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('forEachLimit (bounded worker pool: scheduler sweeps + compliance eval)', () => {
  it('processes every item exactly once', async () => {
    const seen: number[] = [];
    await forEachLimit([1, 2, 3, 4, 5], 2, async n => { seen.push(n); }, () => {});
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('never runs more than `limit` workers at once', async () => {
    let active = 0, peak = 0;
    await forEachLimit(Array.from({ length: 20 }, (_, i) => i), 3, async () => {
      active++;
      peak = Math.max(peak, active);
      await sleep(5);
      active--;
    }, () => {});
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);   // it did actually parallelize
  });

  it('a throwing item is reported and skipped; the sweep continues', async () => {
    const done: number[] = [];
    const failed: Array<{ item: number; msg: string }> = [];
    await forEachLimit([1, 2, 3, 4], 2,
      async n => {
        if (n === 2) throw new Error('device unreachable');
        done.push(n);
      },
      (item, err) => failed.push({ item, msg: err.message }));
    expect(done.sort()).toEqual([1, 3, 4]);
    expect(failed).toEqual([{ item: 2, msg: 'device unreachable' }]);
  });

  it('handles an empty device list without spawning workers', async () => {
    await expect(forEachLimit([], 8, async () => { throw new Error('boom'); }, () => {}))
      .resolves.toBeUndefined();
  });
});
