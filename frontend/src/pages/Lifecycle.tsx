import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAction } from '../hooks/useAction';
import { useApiQuery } from '../hooks/useApiQuery';
import type { Me } from '../App';
import { PageHeader, Card, Button, Modal, Field, inputCls } from '../components/ui';
import { useSiteScope, scoped } from '../context/SiteContext';

interface LifecycleDevice {
  id: string;
  hostname: string;
  mgmt_ip: string;
  model: string;
  ios_version: string;
  eos_date: string | null;
  eol_date: string | null;
  recommended_release: string;
  status: string;
  site_name: string;
}

function daysBetween(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.round((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
}

function LifecycleBadge({ date, label }: { date: string | null; label: string }) {
  const days = daysBetween(date);
  if (!date) return null;
  const past = (days ?? 0) < 0;
  const soon = !past && (days ?? 9999) <= 365;
  return (
    <div className={`inline-flex flex-col items-center rounded-lg px-3 py-1.5 text-center ${
      past ? 'bg-red-100 text-red-800 dark:bg-red-500/10 dark:text-red-400'
      : soon ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-400'
      : 'bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-400'
    }`}>
      <span className="text-[10px] font-semibold uppercase tracking-wide">{label}</span>
      <span className="text-xs font-medium">{new Date(date).toLocaleDateString()}</span>
      {past
        ? <span className="text-[10px]">{Math.abs(days!)}d ago</span>
        : <span className="text-[10px]">{days}d</span>
      }
    </div>
  );
}

type Filter = 'all' | 'eol_passed' | 'eol_soon' | 'eos_passed';

export default function Lifecycle({ me }: { me: Me }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [showCatalog, setShowCatalog] = useState(false);
  const canEdit = me.role === 'superadmin';

  const { data: devices = [], isLoading: loading } =
    useApiQuery<LifecycleDevice[]>(scoped('/api/devices/lifecycle', useSiteScope().siteId));

  const filtered = devices.filter(d => {
    const eolDays = daysBetween(d.eol_date);
    const eosDays = daysBetween(d.eos_date);
    if (filter === 'eol_passed') return eolDays !== null && eolDays < 0;
    if (filter === 'eol_soon')   return eolDays !== null && eolDays >= 0 && eolDays <= 365;
    if (filter === 'eos_passed') return eosDays !== null && eosDays < 0;
    return true;
  });

  const eolPassed = devices.filter(d => (daysBetween(d.eol_date) ?? 1) < 0).length;
  const eolSoon   = devices.filter(d => { const n = daysBetween(d.eol_date); return n !== null && n >= 0 && n <= 365; }).length;
  const eosPassed = devices.filter(d => (daysBetween(d.eos_date) ?? 1) < 0).length;

  return (
    <div>
      <PageHeader title="Switch Lifecycle">
        {canEdit && <Button variant="secondary" onClick={() => setShowCatalog(true)}>Edit catalog</Button>}
      </PageHeader>

      <div className="px-6 py-4 space-y-4">
        {/* Summary chips */}
        <div className="flex flex-wrap gap-3">
          {[
            { key: 'all',        label: `All (${devices.length})`,        color: 'bg-slate-100 text-slate-700 dark:bg-slate-700/50 dark:text-slate-300' },
            { key: 'eol_passed', label: `EOL passed (${eolPassed})`,      color: eolPassed > 0  ? 'bg-red-100 text-red-800 dark:bg-red-500/10 dark:text-red-400'   : 'bg-slate-100 text-slate-400 dark:bg-slate-700/50 dark:text-slate-500' },
            { key: 'eol_soon',   label: `EOL within 1yr (${eolSoon})`,    color: eolSoon > 0    ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-400' : 'bg-slate-100 text-slate-400 dark:bg-slate-700/50 dark:text-slate-500' },
            { key: 'eos_passed', label: `EOS passed (${eosPassed})`,      color: eosPassed > 0  ? 'bg-orange-100 text-orange-800 dark:bg-orange-500/10 dark:text-orange-400' : 'bg-slate-100 text-slate-400 dark:bg-slate-700/50 dark:text-slate-500' },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key as Filter)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${f.color} ${
                filter === f.key ? 'ring-2 ring-offset-1 ring-brand-400' : ''
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <Card>
          {loading ? (
            <p className="text-sm text-slate-400 py-4 text-center dark:text-slate-500">Loading lifecycle data…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-slate-400 py-8 text-center dark:text-slate-500">
              {devices.length === 0
                ? 'No lifecycle data yet — appears after the first device refresh.'
                : 'No devices match this filter.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left dark:border-slate-800">
                    <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Device</th>
                    <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Model</th>
                    <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">IOS Version</th>
                    <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Site</th>
                    <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">End of Sale</th>
                    <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">End of Life</th>
                    <th className="pb-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Recommended</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {filtered.map(d => (
                    <tr key={d.id} className="hover:bg-slate-50/80 transition dark:hover:bg-slate-800/60">
                      <td className="py-3 pr-4">
                        <Link to={`/devices/${d.id}`} className="font-medium text-brand-600 hover:underline dark:text-brand-400">
                          {d.hostname || d.mgmt_ip}
                        </Link>
                        <div className="text-xs text-slate-400 font-mono dark:text-slate-500">{d.mgmt_ip}</div>
                      </td>
                      <td className="py-3 pr-4 text-slate-700 text-xs font-mono dark:text-slate-300">{d.model || '—'}</td>
                      <td className="py-3 pr-4 text-slate-500 text-xs font-mono dark:text-slate-400">{d.ios_version || '—'}</td>
                      <td className="py-3 pr-4 text-xs text-slate-500 dark:text-slate-400">{d.site_name}</td>
                      <td className="py-3 pr-4"><LifecycleBadge date={d.eos_date} label="EOS" /></td>
                      <td className="py-3 pr-4"><LifecycleBadge date={d.eol_date} label="EOL" /></td>
                      <td className="py-3">
                        {d.recommended_release ? (
                          <span className="font-mono text-xs text-brand-600 bg-brand-50 px-2 py-0.5 rounded dark:text-brand-400 dark:bg-brand-500/10">
                            {d.recommended_release}
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {showCatalog && <CatalogEditor onClose={() => setShowCatalog(false)} />}
    </div>
  );
}

interface CatalogEntry {
  model_prefix: string;
  eos_date: string | null;
  eol_date: string | null;
  recommended_release: string;
  notes: string;
  updated_by: string;
  updated_at: string;
}

function CatalogEditor({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<CatalogEntry> | null>(null);
  const { run, busy, isBusy } = useAction();

  const load = () => api<CatalogEntry[]>('/api/lifecycle-catalog')
    .then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const fmtDate = (d: string | null) => d ? String(d).slice(0, 10) : '';

  const save = () => {
    if (!editing?.model_prefix?.trim()) return;
    run(async () => {
      await api(`/api/lifecycle-catalog/${encodeURIComponent(editing.model_prefix!.trim())}`, {
        method: 'PUT',
        body: {
          eosDate: editing.eos_date || null,
          eolDate: editing.eol_date || null,
          recommendedRelease: editing.recommended_release ?? '',
          notes: editing.notes ?? ''
        }
      });
      setEditing(null); load();
    }, { key: 'save' });
  };

  const remove = (prefix: string) => {
    if (!confirm(`Delete lifecycle entry for "${prefix}"?`)) return;
    run(async () => { await api(`/api/lifecycle-catalog/${encodeURIComponent(prefix)}`, { method: 'DELETE' }); load(); }, { key: prefix });
  };

  return (
    <Modal title="Lifecycle catalog" onClose={onClose}>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Model-prefix → EOS/EOL dates. Longest prefix wins at match time. Changes apply on the next device refresh.
        </p>
        <Button onClick={() => setEditing({ model_prefix: '', eos_date: '', eol_date: '', recommended_release: '', notes: '' })}>
          Add entry
        </Button>
      </div>

      {loading ? (
        <p className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">Loading catalog…</p>
      ) : (
        <div className="max-h-[55vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white dark:bg-slate-800">
              <tr className="border-b text-left text-xs uppercase text-slate-500 dark:text-slate-400">
                <th className="py-1.5 pr-3">Prefix</th><th className="pr-3">EOS</th><th className="pr-3">EOL</th>
                <th className="pr-3">Recommended</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.model_prefix} className="border-b last:border-0">
                  <td className="py-1.5 pr-3 font-mono text-xs text-slate-700 dark:text-slate-300">{r.model_prefix}</td>
                  <td className="pr-3 text-xs text-slate-600 dark:text-slate-400">{fmtDate(r.eos_date) || '—'}</td>
                  <td className="pr-3 text-xs text-slate-600 dark:text-slate-400">{fmtDate(r.eol_date) || '—'}</td>
                  <td className="pr-3 font-mono text-xs text-slate-600 dark:text-slate-400">{r.recommended_release || '—'}</td>
                  <td className="space-x-2 text-right">
                    <button className="text-xs text-brand-600 hover:underline dark:text-brand-400"
                            onClick={() => setEditing({ ...r, eos_date: fmtDate(r.eos_date), eol_date: fmtDate(r.eol_date) })}>edit</button>
                    <button className="text-xs text-red-600 hover:underline dark:text-red-400" disabled={isBusy(r.model_prefix)} onClick={() => remove(r.model_prefix)}>{isBusy(r.model_prefix) ? 'deleting…' : 'delete'}</button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-slate-400 dark:text-slate-500">Catalog is empty</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
          <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">
            {rows.some(r => r.model_prefix === editing.model_prefix) ? 'Edit entry' : 'New entry'}
          </h3>
          <Field label="Model prefix">
            <input className={inputCls} value={editing.model_prefix ?? ''}
                   onChange={e => setEditing(p => ({ ...p, model_prefix: e.target.value }))}
                   placeholder="e.g. C9300-" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="End of Sale (YYYY-MM-DD)">
              <input className={inputCls} value={editing.eos_date ?? ''} type="date"
                     onChange={e => setEditing(p => ({ ...p, eos_date: e.target.value }))} />
            </Field>
            <Field label="End of Life (YYYY-MM-DD)">
              <input className={inputCls} value={editing.eol_date ?? ''} type="date"
                     onChange={e => setEditing(p => ({ ...p, eol_date: e.target.value }))} />
            </Field>
          </div>
          <Field label="Recommended release">
            <input className={inputCls} value={editing.recommended_release ?? ''}
                   onChange={e => setEditing(p => ({ ...p, recommended_release: e.target.value }))}
                   placeholder="e.g. 17.12.3" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={busy || !editing.model_prefix?.trim()}>{busy ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
