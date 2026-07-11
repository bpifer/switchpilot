// Cmd+K / Ctrl+K global search across devices, ports, alerts, logs, config
// content, and failing compliance rules.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

interface Results {
  devices: { id: string; hostname: string; mgmt_ip: string; model: string; status: string }[];
  ports: { device_id: string; name: string; description: string; vlan: string; hostname: string }[];
  alerts: { id: string; device_id: string | null; severity: string; kind: string; message: string; hostname: string | null }[];
  logs: { id: string; device_id: string | null; message: string; severity: number | null; hostname: string | null }[];
  configs: { device_id: string; hostname: string; created_at: string }[];
  compliance: { device_id: string; hostname: string; rule_id: string; name: string; severity: string }[];
}

const EMPTY: Results = { devices: [], ports: [], alerts: [], logs: [], configs: [], compliance: [] };

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Results>(EMPTY);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();

  // Global hotkey
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) { setQ(''); setResults(EMPTY); setActive(0); setTimeout(() => inputRef.current?.focus(), 0); }
  }, [open]);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (!q.trim()) { setResults(EMPTY); return; }
    debounce.current = setTimeout(() => {
      api<Results>(`/api/search?q=${encodeURIComponent(q.trim())}`)
        .then(r => { setResults(r); setActive(0); })
        .catch(() => setResults(EMPTY));
    }, 200);
  }, [q]);

  // Flatten results into a single navigable list
  const items: { label: string; sub: string; tag: string; go: () => void }[] = [
    ...results.devices.map(d => ({
      label: d.hostname || d.mgmt_ip, sub: `${d.model || 'device'} · ${d.mgmt_ip}`, tag: d.status,
      go: () => navigate(`/devices/${d.id}`)
    })),
    ...results.ports.map(p => ({
      label: `${p.hostname} · ${p.name}`, sub: `${p.description} (VLAN ${p.vlan})`, tag: 'port',
      go: () => navigate(`/devices/${p.device_id}?tab=ports`)
    })),
    ...results.alerts.map(a => ({
      label: a.message.slice(0, 70), sub: `${a.hostname ?? 'platform'} · ${a.kind}`, tag: a.severity,
      go: () => navigate('/alerts')
    })),
    ...results.logs.map(l => ({
      label: l.message.slice(0, 70), sub: `${l.hostname ?? 'syslog'}`, tag: 'log',
      go: () => navigate(l.device_id ? `/devices/${l.device_id}` : '/logs')
    })),
    // `?? []` keeps a newer frontend resilient against an older backend that
    // doesn't yet return these keys (e.g. mid-deploy).
    ...(results.configs ?? []).map(c => ({
      label: `${c.hostname} · config`, sub: 'match in latest config backup', tag: 'config',
      go: () => navigate(`/devices/${c.device_id}?tab=config`)
    })),
    ...(results.compliance ?? []).map(c => ({
      label: c.name, sub: `${c.hostname} · failing rule`, tag: c.severity,
      go: () => navigate('/compliance')
    }))
  ];

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && items[active]) { items[active].go(); setOpen(false); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 pt-[12vh]" onClick={() => setOpen(false)}>
      <div className="w-[40rem] max-w-[94vw] overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700"
           onClick={e => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={onInputKey}
          placeholder="Search devices, ports, config, compliance, alerts, logs…"
          className="w-full border-b border-slate-100 px-5 py-4 text-sm outline-none placeholder:text-slate-400 dark:border-slate-800 dark:placeholder:text-slate-500"
        />
        <div className="max-h-[50vh] overflow-auto">
          {q.trim() && items.length === 0 && (
            <div className="px-5 py-8 text-center text-sm text-slate-400 dark:text-slate-500">No matches for "{q}"</div>
          )}
          {items.map((it, i) => (
            <button
              key={i}
              onMouseEnter={() => setActive(i)}
              onClick={() => { it.go(); setOpen(false); }}
              className={`flex w-full items-center gap-3 px-5 py-2.5 text-left ${i === active ? 'bg-brand-50 dark:bg-brand-500/10' : ''}`}
            >
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500 dark:bg-slate-700/50 dark:text-slate-400">{it.tag}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-slate-800 dark:text-slate-100">{it.label}</span>
                <span className="block truncate text-xs text-slate-400 dark:text-slate-500">{it.sub}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 border-t border-slate-100 px-5 py-2 text-[11px] text-slate-400 dark:border-slate-800 dark:text-slate-500">
          <span>↑↓ navigate</span><span>↵ open</span><span>esc close</span>
        </div>
      </div>
    </div>
  );
}
