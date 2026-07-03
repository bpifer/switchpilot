import type { ReactNode } from 'react';

export function Icon({ d, className = 'w-4 h-4' }: { d: string; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
         strokeWidth={1.5} stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-4 py-3 shadow-sm sm:px-6 sm:py-4">
      <h1 className="text-lg font-semibold text-slate-800">{title}</h1>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export function Card({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl bg-white shadow-sm ring-1 ring-slate-200/60 ${className}`}>
      {title && (
        <div className="border-b border-slate-100 px-5 py-3 text-sm font-semibold text-slate-700">
          {title}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

export function Button({ children, onClick, variant = 'primary', disabled, type = 'button' }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger'; type?: 'button' | 'submit';
}) {
  const styles = {
    primary:   'bg-brand-600 text-white hover:bg-brand-700 shadow-sm',
    secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 shadow-sm',
    danger:    'bg-red-600 text-white hover:bg-red-700 shadow-sm',
  };
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${styles[variant]}`}
    >
      {children}
    </button>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, { chip: string; dot: string }> = {
    online:       { chip: 'bg-green-50 text-green-700 ring-1 ring-green-600/20',   dot: 'bg-green-500' },
    offline:      { chip: 'bg-red-50 text-red-700 ring-1 ring-red-600/20',         dot: 'bg-red-500' },
    degraded:     { chip: 'bg-yellow-50 text-yellow-700 ring-1 ring-yellow-600/20', dot: 'bg-yellow-500' },
    unknown:      { chip: 'bg-slate-100 text-slate-600',                            dot: 'bg-slate-400' },
    connected:    { chip: 'bg-green-50 text-green-700 ring-1 ring-green-600/20',   dot: 'bg-green-500' },
    notconnect:   { chip: 'bg-slate-100 text-slate-500',                            dot: 'bg-slate-300' },
    disabled:     { chip: 'bg-slate-100 text-slate-500',                            dot: 'bg-slate-300' },
    'err-disabled': { chip: 'bg-red-50 text-red-700 ring-1 ring-red-600/20',       dot: 'bg-red-500' },
    pending:      { chip: 'bg-blue-50 text-blue-700 ring-1 ring-blue-600/20',      dot: 'bg-blue-400' },
    running:      { chip: 'bg-blue-50 text-blue-700 ring-1 ring-blue-600/20',      dot: 'bg-blue-500' },
    done:         { chip: 'bg-green-50 text-green-700 ring-1 ring-green-600/20',   dot: 'bg-green-500' },
    failed:       { chip: 'bg-red-50 text-red-700 ring-1 ring-red-600/20',         dot: 'bg-red-500' },
    cancelled:    { chip: 'bg-slate-100 text-slate-600',                            dot: 'bg-slate-400' },
    critical:     { chip: 'bg-red-50 text-red-700 ring-1 ring-red-600/20',         dot: 'bg-red-500' },
    warning:      { chip: 'bg-amber-50 text-amber-700 ring-1 ring-amber-600/20',   dot: 'bg-amber-500' },
    info:         { chip: 'bg-blue-50 text-blue-700 ring-1 ring-blue-600/20',      dot: 'bg-blue-400' },
  };
  const s = styles[status] ?? { chip: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${s.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {status}
    </span>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[88vh] w-[38rem] max-w-[94vw] overflow-auto rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200/60"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="font-semibold text-slate-800">{title}</h2>
          <button
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            onClick={onClose}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-4 block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

export const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 ' +
  'placeholder:text-slate-400 transition ' +
  'focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20';

export function fmtUptime(seconds: number | null): string {
  if (!seconds) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${Math.floor((seconds % 3600) / 60)}m`;
}
