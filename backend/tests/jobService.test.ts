import { describe, it, expect } from 'vitest';
import { backoffMs, decideJobOutcome } from '../src/services/jobService.js';

describe('backoffMs', () => {
  it('grows exponentially from 2s and caps at 5 minutes', () => {
    expect(backoffMs(1)).toBe(2000);
    expect(backoffMs(2)).toBe(4000);
    expect(backoffMs(3)).toBe(8000);
    expect(backoffMs(20)).toBe(5 * 60_000);   // capped
  });
});

describe('decideJobOutcome', () => {
  const NOW = 1_700_000_000_000;

  it('reschedules a recurring job to its next cron run', () => {
    const o = decideJobOutcome({ cron: '0 * * * *', attempts: 1, max_attempts: 1 }, true, NOW);
    expect(o.action).toBe('reschedule');
    if (o.action === 'reschedule') expect(o.at).toBeInstanceOf(Date);
  });

  it('marks a successful one-shot done', () => {
    expect(decideJobOutcome({ cron: null, attempts: 1, max_attempts: 3 }, true, NOW)).toEqual({ action: 'done' });
  });

  it('retries a failed one-shot with backoff while attempts remain', () => {
    const o = decideJobOutcome({ cron: null, attempts: 1, max_attempts: 3 }, false, NOW);
    expect(o.action).toBe('retry');
    if (o.action === 'retry') expect(o.runAfter.getTime()).toBe(NOW + backoffMs(1));
  });

  it('fails a one-shot once attempts are exhausted', () => {
    expect(decideJobOutcome({ cron: null, attempts: 3, max_attempts: 3 }, false, NOW)).toEqual({ action: 'fail' });
  });

  it('a recurring job reschedules even after a failure (never gives up)', () => {
    expect(decideJobOutcome({ cron: '*/5 * * * *', attempts: 2, max_attempts: 1 }, false, NOW).action).toBe('reschedule');
  });
});
