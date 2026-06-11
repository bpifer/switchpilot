import type { ReactNode } from 'react';

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b bg-white px-6 py-4">
      <h1 className="text-xl font-semibold text-gray-800">{title}</h1>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}

export function Card({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border bg-white shadow-sm ${className}`}>
      {title && <div className="border-b px-4 py-3 text-sm font-semibold text-gray-700">{title}</div>}
      <div className="p-4">{children}</div>
    </div>
  );
}

export function Button({ children, onClick, variant = 'primary', disabled, type = 'button' }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger'; type?: 'button' | 'submit';
}) {
  const styles = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700',
    secondary: 'border bg-white text-gray-700 hover:bg-gray-50',
    danger: 'bg-red-600 text-white hover:bg-red-700'
  };
  return (
    <button type={type} disabled={disabled} onClick={onClick}
            className={`rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${styles[variant]}`}>
      {children}
    </button>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    online: 'bg-green-100 text-green-800',
    offline: 'bg-red-100 text-red-800',
    degraded: 'bg-yellow-100 text-yellow-800',
    unknown: 'bg-gray-100 text-gray-600',
    connected: 'bg-green-100 text-green-800',
    notconnect: 'bg-gray-100 text-gray-600',
    disabled: 'bg-gray-200 text-gray-500',
    'err-disabled': 'bg-red-100 text-red-800',
    pending: 'bg-blue-100 text-blue-800',
    running: 'bg-blue-100 text-blue-800',
    done: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
    cancelled: 'bg-gray-100 text-gray-600',
    critical: 'bg-red-100 text-red-800',
    warning: 'bg-yellow-100 text-yellow-800',
    info: 'bg-blue-100 text-blue-800'
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="max-h-[85vh] w-[36rem] max-w-[92vw] overflow-auto rounded-lg bg-white shadow-xl"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button className="text-gray-400 hover:text-gray-700" onClick={onClose}>✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      {children}
    </label>
  );
}

export const inputCls = 'w-full rounded border px-3 py-2 text-sm';

export function fmtUptime(seconds: number | null): string {
  if (!seconds) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${Math.floor((seconds % 3600) / 60)}m`;
}
