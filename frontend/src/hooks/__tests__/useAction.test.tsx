import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAction } from '../useAction';
import { toast } from '../../components/Toast';

vi.mock('../../components/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

beforeEach(() => vi.clearAllMocks());

describe('useAction', () => {
  it('tracks busy across the action and returns its result', async () => {
    const { result } = renderHook(() => useAction());
    expect(result.current.busy).toBe(false);

    let release!: (v: string) => void;
    const pending = new Promise<string>(r => { release = r; });

    let out: Promise<string | undefined>;
    act(() => { out = result.current.run(() => pending); });
    expect(result.current.busy).toBe(true);

    await act(async () => { release('done'); await pending; });
    expect(await out!).toBe('done');
    expect(result.current.busy).toBe(false);
  });

  it('toasts the error and resolves undefined instead of throwing', async () => {
    const { result } = renderHook(() => useAction());
    let out: string | undefined = 'sentinel';
    await act(async () => {
      out = await result.current.run<string>(() => Promise.reject(new Error('device unreachable')));
    });
    expect(out).toBeUndefined();
    expect(toast.error).toHaveBeenCalledWith('device unreachable');
    expect(result.current.busy).toBe(false);
  });

  it('shows the success toast only when the action succeeds', async () => {
    const { result } = renderHook(() => useAction());
    await act(async () => { await result.current.run(async () => {}, { success: 'Saved.' }); });
    expect(toast.success).toHaveBeenCalledWith('Saved.');

    await act(async () => {
      await result.current.run(() => Promise.reject(new Error('nope')), { success: 'Saved.' });
    });
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('isBusy distinguishes per-row keys', async () => {
    const { result } = renderHook(() => useAction());
    let release!: () => void;
    const pending = new Promise<void>(r => { release = r; });

    act(() => { void result.current.run(() => pending, { key: 'row-1' }); });
    expect(result.current.isBusy('row-1')).toBe(true);
    expect(result.current.isBusy('row-2')).toBe(false);
    expect(result.current.busy).toBe(true);

    await act(async () => { release(); await pending; });
    expect(result.current.isBusy('row-1')).toBe(false);
    expect(result.current.busy).toBe(false);
  });
});
