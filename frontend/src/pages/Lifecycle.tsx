import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { PageHeader, Card } from '../components/ui';

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
      past ? 'bg-red-100 text-red-800'
      : soon ? 'bg-amber-100 text-amber-800'
      : 'bg-slate-100 text-slate-600'
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

export default function Lifecycle() {
  const [devices, setDevices] = useState<LifecycleDevice[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<LifecycleDevice[]>('/api/devices/lifecycle')
      .then(setDevices)
      .catch(() => setDevices([]))
      .finally(() => setLoading(false));
  }, []);

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
      <PageHeader title="Switch Lifecycle" />

      <div className="px-6 py-4 space-y-4">
        {/* Summary chips */}
        <div className="flex flex-wrap gap-3">
          {[
            { key: 'all',        label: `All (${devices.length})`,        color: 'bg-slate-100 text-slate-700' },
            { key: 'eol_passed', label: `EOL passed (${eolPassed})`,      color: eolPassed > 0  ? 'bg-red-100 text-red-800'   : 'bg-slate-100 text-slate-400' },
            { key: 'eol_soon',   label: `EOL within 1yr (${eolSoon})`,    color: eolSoon > 0    ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-400' },
            { key: 'eos_passed', label: `EOS passed (${eosPassed})`,      color: eosPassed > 0  ? 'bg-orange-100 text-orange-800' : 'bg-slate-100 text-slate-400' },
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
            <p className="text-sm text-slate-400 py-4 text-center">Loading lifecycle data…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-slate-400 py-8 text-center">
              {devices.length === 0
                ? 'No lifecycle data yet — appears after the first device refresh.'
                : 'No devices match this filter.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left">
                    <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Device</th>
                    <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Model</th>
                    <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">IOS Version</th>
                    <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Site</th>
                    <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">End of Sale</th>
                    <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">End of Life</th>
                    <th className="pb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Recommended</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filtered.map(d => (
                    <tr key={d.id} className="hover:bg-slate-50/80 transition">
                      <td className="py-3 pr-4">
                        <Link to={`/devices/${d.id}`} className="font-medium text-brand-600 hover:underline">
                          {d.hostname || d.mgmt_ip}
                        </Link>
                        <div className="text-xs text-slate-400 font-mono">{d.mgmt_ip}</div>
                      </td>
                      <td className="py-3 pr-4 text-slate-700 text-xs font-mono">{d.model || '—'}</td>
                      <td className="py-3 pr-4 text-slate-500 text-xs font-mono">{d.ios_version || '—'}</td>
                      <td className="py-3 pr-4 text-xs text-slate-500">{d.site_name}</td>
                      <td className="py-3 pr-4"><LifecycleBadge date={d.eos_date} label="EOS" /></td>
                      <td className="py-3 pr-4"><LifecycleBadge date={d.eol_date} label="EOL" /></td>
                      <td className="py-3">
                        {d.recommended_release ? (
                          <span className="font-mono text-xs text-brand-600 bg-brand-50 px-2 py-0.5 rounded">
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
    </div>
  );
}
