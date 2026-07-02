/** Buffered batch writer: collect items and hand them to `flush` either every
 *  `intervalMs` or as soon as `maxBatch` items are queued, whichever comes
 *  first. `maxBuffer` caps memory during a flush-target outage - overflow items
 *  are dropped (ingestion here is best-effort telemetry, never control flow).
 *  A failed flush drops its batch rather than re-queueing, so a dead database
 *  can't balloon memory or create a retry storm. */
export interface Batcher<T> {
  push(item: T): void;
  /** Flush whatever is queued now (also used by tests and shutdown paths). */
  flushNow(): Promise<void>;
  /** Number of items currently queued (visible for tests/metrics). */
  size(): number;
  stop(): void;
}

export function createBatcher<T>(opts: {
  intervalMs: number;
  maxBatch: number;
  maxBuffer: number;
  flush: (items: T[]) => Promise<void>;
  onError?: (err: Error, dropped: number) => void;
}): Batcher<T> {
  let buffer: T[] = [];
  let flushing = false;

  async function flushNow(): Promise<void> {
    if (flushing || buffer.length === 0) return;   // one flush in flight at a time
    flushing = true;
    const batch = buffer;
    buffer = [];
    try {
      await opts.flush(batch);
    } catch (err) {
      opts.onError?.(err as Error, batch.length);
    } finally {
      flushing = false;
    }
  }

  const timer = setInterval(() => { void flushNow(); }, opts.intervalMs);
  timer.unref?.();

  return {
    push(item: T) {
      if (buffer.length >= opts.maxBuffer) return;   // shed load, don't grow
      buffer.push(item);
      if (buffer.length >= opts.maxBatch) void flushNow();
    },
    flushNow,
    size: () => buffer.length,
    stop() { clearInterval(timer); },
  };
}
