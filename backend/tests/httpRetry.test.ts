import { describe, it, expect, vi } from 'vitest';
import { fetchWithRetry, isRetriableStatus } from '../src/util/httpRetry.js';

const res = (status: number) => ({ ok: status >= 200 && status < 300, status }) as Response;
const noSleep = vi.fn(async () => {});

describe('isRetriableStatus', () => {
  it('retries 429 and 5xx, not 2xx/3xx/4xx', () => {
    expect(isRetriableStatus(429)).toBe(true);
    expect(isRetriableStatus(500)).toBe(true);
    expect(isRetriableStatus(503)).toBe(true);
    expect(isRetriableStatus(200)).toBe(false);
    expect(isRetriableStatus(301)).toBe(false);
    expect(isRetriableStatus(400)).toBe(false);
    expect(isRetriableStatus(404)).toBe(false);
  });
});

describe('fetchWithRetry', () => {
  it('returns on the first success without sleeping', async () => {
    const fetchImpl = vi.fn(async () => res(200));
    const r = await fetchWithRetry('http://x', { method: 'POST' }, { fetchImpl, sleep: noSleep });
    expect(r).toEqual({ ok: true, status: '200', attempts: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(noSleep).not.toHaveBeenCalled();
  });

  it('does not retry a 4xx (permanent client error)', async () => {
    const fetchImpl = vi.fn(async () => res(404));
    const r = await fetchWithRetry('http://x', {}, { fetchImpl, sleep: vi.fn(async () => {}), maxAttempts: 3 });
    expect(r).toMatchObject({ ok: false, status: '404', attempts: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries a 5xx then succeeds', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(res(503))
      .mockResolvedValueOnce(res(200));
    const sleep = vi.fn(async () => {});
    const r = await fetchWithRetry('http://x', {}, { fetchImpl, sleep });
    expect(r).toEqual({ ok: true, status: '200', attempts: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('retries a network error then succeeds', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(res(200));
    const r = await fetchWithRetry('http://x', {}, { fetchImpl, sleep: noSleep });
    expect(r).toMatchObject({ ok: true, status: '200', attempts: 2 });
  });

  it('gives up after maxAttempts on a persistent 503, reporting the count', async () => {
    const fetchImpl = vi.fn(async () => res(503));
    const sleep = vi.fn(async () => {});
    const r = await fetchWithRetry('http://x', {}, { fetchImpl, sleep, maxAttempts: 3 });
    expect(r).toEqual({ ok: false, status: '503', attempts: 3 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);   // between the 3 attempts
  });

  it('gives up after maxAttempts on a persistent network error', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('timeout'); });
    const r = await fetchWithRetry('http://x', {}, { fetchImpl, sleep: noSleep, maxAttempts: 2 });
    expect(r.ok).toBe(false);
    expect(r.status).toMatch(/error: timeout/);
    expect(r.attempts).toBe(2);
  });

  it('backs off exponentially from the base delay', async () => {
    const fetchImpl = vi.fn(async () => res(500));
    const delays: number[] = [];
    const sleep = vi.fn(async (ms: number) => { delays.push(ms); });
    await fetchWithRetry('http://x', {}, { fetchImpl, sleep, maxAttempts: 4, baseDelayMs: 100 });
    expect(delays).toEqual([100, 200, 400]);   // 2^0, 2^1, 2^2 * base
  });
});
