import { useApiQuery } from '../hooks/useApiQuery';
import { PageHeader, Card } from '../components/ui';
import { useSiteScope, scoped } from '../context/SiteContext';

interface PoEDevice {
  device_id: string;
  hostname: string;
  mgmt_ip: string;
  status: string;
  site_name: string;
  poe_watts_used: number;
  poe_watts_capacity: number;
  poe_pct: number | null;
}

interface PoESite {
  site_name: string;
  switch_count: number;
  poe_watts_used: number;
  poe_watts_capacity: number;
  poe_pct: number | null;
}

function pctColor(pct: number | null): string {
  if (pct == null) return 'bg-slate-200';
  if (pct >= 90) return 'bg-red-500';
  if (pct >= 70) return 'bg-amber-400';
  return 'bg-green-500';
}

function pctText(pct: number | null): string {
  if (pct == null) return '—';
  return `${pct}%`;
}

function watts(w: number | null): string {
  if (w == null) return '—';
  return `${Math.round(w)} W`;
}

function PoEBar({ pct }: { pct: number | null }) {
  const p = Math.max(0, Math.min(100, pct ?? 0));
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pctColor(pct)}`}
          style={{ width: `${p}%` }}
        />
      </div>
      <span className={`text-xs font-semibold w-10 text-right ${
        (pct ?? 0) >= 90 ? 'text-red-600' : (pct ?? 0) >= 70 ? 'text-amber-600' : 'text-green-700'
      }`}>
        {pctText(pct)}
      </span>
    </div>
  );
}

export default function PoE() {
  const { data = null, isLoading: loading } =
    useApiQuery<{ devices: PoEDevice[]; sites: PoESite[] }>(scoped('/api/poe/summary', useSiteScope().siteId), { refetchInterval: 60000 });

  if (loading) return <div className="p-8 text-slate-400 text-sm">Loading PoE data…</div>;

  const { devices = [], sites = [] } = data ?? {};
  const totalUsed = devices.reduce((s, d) => s + (d.poe_watts_used ?? 0), 0);
  const totalCap  = devices.reduce((s, d) => s + (d.poe_watts_capacity ?? 0), 0);
  const totalPct  = totalCap > 0 ? Math.round(totalUsed / totalCap * 100) : null;

  return (
    <div>
      <PageHeader title="PoE Dashboard" />

      <div className="px-6 py-4 space-y-6">
        {/* Fleet summary */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Total Budget</div>
            <div className="text-2xl font-bold text-slate-800">{watts(totalCap)}</div>
            <div className="text-xs text-slate-400 mt-0.5">{devices.length} PoE-capable switch{devices.length !== 1 ? 'es' : ''}</div>
          </Card>
          <Card>
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">In Use</div>
            <div className="text-2xl font-bold text-slate-800">{watts(totalUsed)}</div>
            <div className="text-xs text-slate-400 mt-0.5">{pctText(totalPct)} of total budget</div>
          </Card>
          <Card>
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Remaining</div>
            <div className="text-2xl font-bold text-green-700">{watts(totalCap - totalUsed)}</div>
            <div className="text-xs text-slate-400 mt-0.5">Available headroom</div>
          </Card>
        </div>

        {/* Per-site rollup */}
        {sites.length > 0 && (
          <Card>
            <h2 className="text-sm font-semibold text-slate-700 mb-4">By Site</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {sites.map(s => (
                <div key={s.site_name} className={`rounded-lg p-4 border ${
                  (s.poe_pct ?? 0) >= 90 ? 'border-red-200 bg-red-50'
                  : (s.poe_pct ?? 0) >= 70 ? 'border-amber-200 bg-amber-50'
                  : 'border-slate-200 bg-slate-50'
                }`}>
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-800">{s.site_name}</div>
                      <div className="text-xs text-slate-500">{s.switch_count} switch{s.switch_count !== 1 ? 'es' : ''}</div>
                    </div>
                    <span className={`text-lg font-bold ${
                      (s.poe_pct ?? 0) >= 90 ? 'text-red-600'
                      : (s.poe_pct ?? 0) >= 70 ? 'text-amber-600'
                      : 'text-green-700'
                    }`}>
                      {pctText(s.poe_pct)}
                    </span>
                  </div>
                  <PoEBar pct={s.poe_pct} />
                  <div className="flex justify-between text-xs text-slate-400 mt-1.5">
                    <span>{watts(s.poe_watts_used)} used</span>
                    <span>{watts(s.poe_watts_capacity)} total</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Per-switch table */}
        <Card>
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Per Switch</h2>
          {devices.length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">
              No PoE data yet — PoE switches populate after the first device refresh.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left">
                    <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Switch</th>
                    <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Site</th>
                    <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Used</th>
                    <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Capacity</th>
                    <th className="pb-3 text-xs font-semibold uppercase tracking-wide text-slate-500 min-w-32">Utilization</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {devices.map(d => (
                    <tr key={d.device_id} className="hover:bg-slate-50/80 transition">
                      <td className="py-3 pr-4">
                        <div className="font-medium text-slate-800">{d.hostname || d.mgmt_ip}</div>
                        <div className="text-xs text-slate-400 font-mono">{d.mgmt_ip}</div>
                      </td>
                      <td className="py-3 pr-4 text-slate-600 text-xs">{d.site_name}</td>
                      <td className="py-3 pr-4 text-slate-700 tabular-nums">{watts(d.poe_watts_used)}</td>
                      <td className="py-3 pr-4 text-slate-500 tabular-nums">{watts(d.poe_watts_capacity)}</td>
                      <td className="py-3 min-w-32"><PoEBar pct={d.poe_pct} /></td>
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
