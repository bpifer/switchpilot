/** Run fn over items with a bounded worker pool. A per-item failure is handed
 *  to onError and skipped, so one bad device can never stall or abort a sweep.
 *  Shared by the scheduler's device sweeps and the compliance evaluator. */
export async function forEachLimit<T>(
  items: readonly T[], limit: number,
  fn: (item: T) => Promise<void>,
  onError: (item: T, err: Error) => void
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift()!;
      try {
        await fn(item);
      } catch (err) {
        onError(item, err as Error);
      }
    }
  });
  await Promise.all(workers);
}
