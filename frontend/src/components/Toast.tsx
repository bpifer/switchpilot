import { useSyncExternalStore } from 'react';

// Shared toast notifications. A module-level store so any code can call
// toast.error(...) imperatively (no provider/hook plumbing at the call site);
// <Toaster /> is mounted once at the app root and renders the stack.
export interface ToastItem { id: number; kind: 'error' | 'success' | 'info'; message: string; }

let items: ToastItem[] = [];
const listeners = new Set<() => void>();
let nextId = 1;

function notify(): void { for (const l of listeners) l(); }

function dismiss(id: number): void {
  items = items.filter(t => t.id !== id);
  notify();
}

function emit(kind: ToastItem['kind'], message: string): void {
  const id = nextId++;
  items = [...items, { id, kind, message }];
  notify();
  // Errors linger a little longer than confirmations.
  setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 4000);
}

export const toast = {
  error: (message: string) => emit('error', message),
  success: (message: string) => emit('success', message),
  info: (message: string) => emit('info', message),
};

function subscribe(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }
function getSnapshot(): ToastItem[] { return items; }

export function Toaster() {
  const toasts = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 flex-col gap-2">
      {toasts.map(t => (
        <div
          key={t.id}
          role="status"
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto cursor-pointer rounded-lg px-4 py-3 text-sm shadow-lg ring-1 ${
            t.kind === 'error' ? 'bg-red-600 text-white ring-red-700'
            : t.kind === 'success' ? 'bg-emerald-600 text-white ring-emerald-700'
            : 'bg-slate-800 text-white ring-slate-700'}`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
