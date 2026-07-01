import { useState } from 'react';
import { toast } from '../components/Toast';

/**
 * Shared mutation helper: wraps an async action with busy tracking and
 * toast-on-error, replacing the hand-rolled setBusy/try/catch/finally
 * boilerplate on every page.
 *
 *   const { run, busy, isBusy } = useAction();
 *   <Button disabled={busy} onClick={() => run(() => api('/api/...', { method: 'POST' }),
 *                                              { success: 'Saved.' })}>Save</Button>
 *
 * Pass `key` when a list renders one button per row, so only the clicked row
 * shows as busy: `run(fn, { key: rule.id })` + `isBusy(rule.id)`.
 * The action's promise result is returned (undefined on error), so callers can
 * chain refetches: `await run(...)`.
 */
export function useAction() {
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function run<T>(
    fn: () => Promise<T>,
    opts: { key?: string; success?: string } = {}
  ): Promise<T | undefined> {
    setBusyKey(opts.key ?? '');
    try {
      const result = await fn();
      if (opts.success) toast.success(opts.success);
      return result;
    } catch (err: any) {
      toast.error(err.message);
      return undefined;
    } finally {
      setBusyKey(null);
    }
  }

  return {
    run,
    /** True while any action from this hook instance is in flight. */
    busy: busyKey !== null,
    /** True while the action started with this key is in flight. */
    isBusy: (key: string) => busyKey === key,
  };
}
