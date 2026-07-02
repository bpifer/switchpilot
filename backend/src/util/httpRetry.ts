// Outbound HTTP with bounded retry for transient failures. Used by the alert
// webhook sender and the extra notification channels so a receiver that is
// briefly down (restarting, a network blip, a 503) doesn't silently lose the
// event. A 4xx is a permanent client error (bad URL, auth, payload) and is
// never retried. fetch/sleep are injectable so the retry logic is unit-tested
// without real network or real delays.

/** Retry only on transient conditions: request throttling (429) and server
 *  errors (5xx). 2xx is success and 4xx is a permanent client error. */
export function isRetriableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

export interface RetryOutcome {
  ok: boolean;        // a 2xx was received
  status: string;     // "200", "503", or "error: <message>"
  attempts: number;   // how many requests were actually made
}

export interface RetryOptions {
  maxAttempts?: number;   // total attempts including the first (default 3)
  baseDelayMs?: number;   // backoff = base * 2^(attempt-1) (default 500)
  timeoutMs?: number;     // per-attempt timeout (default 10000)
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** POST/GET `init` to `url`, retrying transient failures with exponential
 *  backoff. Resolves with the final outcome; never throws. */
export async function fetchWithRetry(url: string, init: RequestInit, opts: RetryOptions = {}): Promise<RetryOutcome> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;

  let last: RetryOutcome = { ok: false, status: 'error: not attempted', attempts: 0 };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      last = { ok: res.ok, status: String(res.status), attempts: attempt };
      if (res.ok || !isRetriableStatus(res.status)) return last;   // success or permanent failure
    } catch (err) {
      last = { ok: false, status: `error: ${(err as Error).message.slice(0, 100)}`, attempts: attempt };
    }
    if (attempt < maxAttempts) await sleep(baseDelayMs * 2 ** (attempt - 1));
  }
  return last;   // exhausted retries on a transient failure
}
