// Fleet PoE budget view. Rendered as a tab inside Analytics (and nothing else),
// so it carries no page header of its own. Scope follows the global site
// selector. Metrics (poe_watts_used / poe_watts_capacity) are vendor-neutral.
import { useState } from 'react';
import { useApiQuery } from '../hooks/useApiQuery';
import { Card } from './ui';
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
  if (pct == null) return 'bg-slate-200 dark:bg-slate-700';
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
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden dark:bg-slate-700/50">
        <div
          className={`h-full rounded-full transition-all ${pctColor(pct)}`}
          style={{ width: `${p}%` }}
        />
      </div>
      <span className={`text-xs font-semibold w-10 text-right ${
        (pct ?? 0) >= 90 ? 'text-red-600 dark:text-red-400' : (pct ?? 0) >= 70 ? 'text-amber-600 dark:text-amber-400' : 'text-green-700 dark:text-green-400'
      }`}>
        {pctText(pct)}
      </span>
    </div>
  );
}

export default function PoePanel({ onSelectDevice }: { onSelectDevice?: (id: string) => void }) {
  const { data = null, isLoading: loading } =
    useApiQuery<{ devices: PoEDevice[]; sites: PoESite[] }>(scoped('/api/poe/summary', useSiteScope().siteId), { refetchInterval: 60000 });

  if (loading) return <div className="py-8 text-slate-400 text-sm dark:text-slate-500">Loading PoE data…</div>;

  const { devices = [], sites = [] } = data ?? {};
  const totalUsed = devices.reduce((s, d) => s + (d.poe_watts_used ?? 0), 0);
  const totalCap  = devices.reduce((s, d) => s + (d.poe_watts_capacity ?? 0), 0);
  const totalPct  = totalCap > 0 ? Math.round(totalUsed / totalCap * 100) : null;

  return (
    <div className="space-y-6">
      <PoeEnergy />
      {/* Fleet summary */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1 dark:text-slate-400">Total Budget</div>
          <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{watts(totalCap)}</div>
          <div className="text-xs text-slate-400 mt-0.5 dark:text-slate-500">{devices.length} PoE-capable switch{devices.length !== 1 ? 'es' : ''}</div>
        </Card>
        <Card>
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1 dark:text-slate-400">In Use</div>
          <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{watts(totalUsed)}</div>
          <div className="text-xs text-slate-400 mt-0.5 dark:text-slate-500">{pctText(totalPct)} of total budget</div>
        </Card>
        <Card>
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1 dark:text-slate-400">Remaining</div>
          <div className="text-2xl font-bold text-green-700 dark:text-green-400">{watts(totalCap - totalUsed)}</div>
          <div className="text-xs text-slate-400 mt-0.5 dark:text-slate-500">Available headroom</div>
        </Card>
      </div>

      {/* Per-site rollup */}
      {sites.length > 0 && (
        <Card>
          <h2 className="text-sm font-semibold text-slate-700 mb-4 dark:text-slate-300">By Site</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sites.map(s => (
              <div key={s.site_name} className={`rounded-lg p-4 border ${
                (s.poe_pct ?? 0) >= 90 ? 'border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10'
                : (s.poe_pct ?? 0) >= 70 ? 'border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10'
                : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50'
              }`}>
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{s.site_name}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{s.switch_count} switch{s.switch_count !== 1 ? 'es' : ''}</div>
                  </div>
                  <span className={`text-lg font-bold ${
                    (s.poe_pct ?? 0) >= 90 ? 'text-red-600 dark:text-red-400'
                    : (s.poe_pct ?? 0) >= 70 ? 'text-amber-600 dark:text-amber-400'
                    : 'text-green-700 dark:text-green-400'
                  }`}>
                    {pctText(s.poe_pct)}
                  </span>
                </div>
                <PoEBar pct={s.poe_pct} />
                <div className="flex justify-between text-xs text-slate-400 mt-1.5 dark:text-slate-500">
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
        <h2 className="text-sm font-semibold text-slate-700 mb-4 dark:text-slate-300">Per Switch</h2>
        {devices.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center dark:text-slate-500">
            No PoE data yet — PoE switches populate after the first device refresh.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left dark:border-slate-800">
                  <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Switch</th>
                  <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Site</th>
                  <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Used</th>
                  <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Capacity</th>
                  <th className="pb-3 text-xs font-semibold uppercase tracking-wide text-slate-500 min-w-32 dark:text-slate-400">Utilization</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {devices.map(d => (
                  <tr key={d.device_id} className="hover:bg-slate-50/80 transition dark:hover:bg-slate-800/60">
                    <td className="py-3 pr-4">
                      {onSelectDevice ? (
                        <button
                          onClick={() => onSelectDevice(d.device_id)}
                          title="View this switch's metrics"
                          className="text-left"
                        >
                          <div className="font-medium text-brand-700 hover:underline dark:text-brand-400">{d.hostname || d.mgmt_ip}</div>
                          <div className="text-xs text-slate-400 font-mono dark:text-slate-500">{d.mgmt_ip}</div>
                        </button>
                      ) : (
                        <>
                          <div className="font-medium text-slate-800 dark:text-slate-100">{d.hostname || d.mgmt_ip}</div>
                          <div className="text-xs text-slate-400 font-mono dark:text-slate-500">{d.mgmt_ip}</div>
                        </>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-slate-600 text-xs dark:text-slate-400">{d.site_name}</td>
                    <td className="py-3 pr-4 text-slate-700 tabular-nums dark:text-slate-300">{watts(d.poe_watts_used)}</td>
                    <td className="py-3 pr-4 text-slate-500 tabular-nums dark:text-slate-400">{watts(d.poe_watts_capacity)}</td>
                    <td className="py-3 min-w-32"><PoEBar pct={d.poe_pct} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function fmtKwh(n: number): string {
  return `${n.toLocaleString(undefined, { maximumFractionDigits: n >= 100 ? 0 : 1 })} kWh`;
}

interface EnergyResp {
  range: string; hours: number; rate: number;
  devices: { device_id: string; hostname: string; mgmt_ip: string; avg_watts: number; kwh: number; cost: number | null }[];
  total: { kwh: number; cost: number | null };
}

// PoE energy + estimated cost over a window. Cost shows only when
// POE_RATE_PER_KWH is set (rate > 0); the currency is the operator's own.
function PoeEnergy() {
  const { siteId } = useSiteScope();
  const [range, setRange] = useState<'24h' | '7d' | '30d'>('7d');
  const { data } = useApiQuery<EnergyResp>(scoped(`/api/poe/energy?range=${range}`, siteId), { refetchInterval: 300000 });
  const RANGES: { v: '24h' | '7d' | '30d'; label: string }[] = [
    { v: '24h', label: '24h' }, { v: '7d', label: '7 days' }, { v: '30d', label: '30 days' },
  ];

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Energy &amp; cost</h2>
        <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          {RANGES.map(r => (
            <button key={r.v} onClick={() => setRange(r.v)}
              className={`px-2.5 py-1 text-xs transition ${range === r.v ? 'bg-brand-600 font-medium text-white dark:bg-brand-500' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-700'}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      {!data ? (
        <p className="py-2 text-sm text-slate-400 dark:text-slate-500">Loading…</p>
      ) : data.devices.length === 0 ? (
        <p className="py-2 text-sm text-slate-400 dark:text-slate-500">No PoE energy data yet for this range.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-8">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Energy</div>
              <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{fmtKwh(data.total.kwh)}</div>
            </div>
            {data.total.cost != null ? (
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Est. cost</div>
                <div className="text-2xl font-bold text-emerald-700">{data.total.cost.toFixed(2)}</div>
                <div className="text-xs text-slate-400 dark:text-slate-500">@ {data.rate}/kWh</div>
              </div>
            ) : (
              <div className="self-center text-xs text-slate-400 dark:text-slate-500">
                Set <span className="font-mono">POE_RATE_PER_KWH</span> to estimate cost.
              </div>
            )}
          </div>
          <div className="mt-4 space-y-1.5">
            {data.devices.slice(0, 6).map(d => (
              <div key={d.device_id} className="flex items-center justify-between text-sm">
                <span className="truncate pr-3 text-slate-700 dark:text-slate-300">{d.hostname || d.mgmt_ip}</span>
                <span className="shrink-0 tabular-nums text-slate-500 dark:text-slate-400">
                  {d.avg_watts} W avg · {fmtKwh(d.kwh)}{d.cost != null ? ` · ${d.cost.toFixed(2)}` : ''}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
