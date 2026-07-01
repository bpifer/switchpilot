import { useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { api } from '../api';
import type { Me } from '../App';
import { useAction } from '../hooks/useAction';
import { useApiQuery } from '../hooks/useApiQuery';
import { useSiteScope, scoped } from '../context/SiteContext';
import { PageHeader, Card, Button } from '../components/ui';

type Range = '1h' | '24h' | '7d';
const RANGES: { value: Range; label: string }[] = [
  { value: '1h', label: '1 hour' },
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
];

// Postgres returns bigint sums as strings; coerce before formatting/plotting.
function fmtBytes(n: number | null): string {
  if (n == null || Number.isNaN(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let v = n, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

function fmtTime(ts: string, range: Range): string {
  const d = new Date(ts);
  if (range === '7d') return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric' });
  if (range === '1h') return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleTimeString('en-US', { hour: 'numeric' });
}

export default function Traffic({ me }: { me: Me }) {
  const { siteId } = useSiteScope();
  const [range, setRange] = useState<Range>('24h');
  const [deviceId, setDeviceId] = useState('');
  const { run, busy: exporting } = useAction();
  const canConfig = me.role === 'superadmin' || me.role === 'netadmin';

  // Point the selected device's NetFlow/traffic-flow export at this collector
  // (idempotent config push; the backend resolves host/port from its env).
  const enableExport = () => run(
    () => api(`/api/devices/${deviceId}/flow-export`, { method: 'POST' }),
    { success: 'Flow export configured. Flows should appear within a few minutes.' });

  const { data: devices = [] } = useApiQuery<any[]>(scoped('/api/devices', siteId));
  const { data: status } = useApiQuery<{ enabled: boolean; port: number; records: number; latest: string | null }>(
    '/api/traffic/status', { refetchInterval: 30000 });

  const q = `range=${range}${deviceId ? `&deviceId=${deviceId}` : ''}`;
  const { data: talkers = [] } = useApiQuery<{ host: string; bytes: string; packets: string }[]>(`/api/traffic/top-talkers?${q}`, { refetchInterval: 30000 });
  const { data: apps = [] } = useApiQuery<{ app: string; bytes: string }[]>(`/api/traffic/apps?${q}`, { refetchInterval: 30000 });
  const { data: series = [] } = useApiQuery<{ bucket: string; bytes: string }[]>(`/api/traffic/series?${q}`, { refetchInterval: 30000 });

  const noData = status && status.records === 0;
  const seriesData = series.map(s => ({ bucket: s.bucket, bytes: Number(s.bytes) }));
  const appMax = Math.max(1, ...apps.map(a => Number(a.bytes)));
  const talkerMax = Math.max(1, ...talkers.map(t => Number(t.bytes)));

  return (
    <div>
      <PageHeader title="Traffic" />

      <div className="flex flex-wrap items-center gap-3 px-6 py-4">
        <select className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
                value={deviceId} onChange={e => setDeviceId(e.target.value)}>
          <option value="">All exporters</option>
          {devices.map(d => <option key={d.id} value={d.id}>{d.hostname || d.mgmt_ip}</option>)}
        </select>
        <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-white">
          {RANGES.map(r => (
            <button key={r.value} onClick={() => setRange(r.value)}
              className={`px-3 py-1.5 text-sm transition ${range === r.value ? 'bg-brand-600 font-medium text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
              {r.label}
            </button>
          ))}
        </div>
        {canConfig && deviceId && (
          <Button variant="secondary" disabled={exporting || !status?.enabled} onClick={enableExport}>
            {exporting ? 'Configuring…' : 'Enable export on this device'}
          </Button>
        )}
        {status && (
          <span className="ml-auto text-xs text-slate-400">
            {status.enabled ? `Collector on udp/${status.port}` : 'Collector disabled'}
            {status.latest ? ` · last flow ${new Date(status.latest).toLocaleTimeString()}` : ''}
          </span>
        )}
      </div>

      {noData ? (
        <div className="px-6 pb-6">
          <Card>
            <div className="py-8 text-center text-sm text-slate-500">
              <p className="font-medium text-slate-700">No flow data yet.</p>
              <p className="mt-1">
                {status?.enabled
                  ? <>The collector is listening on <span className="font-mono">udp/{status.port}</span>. Point a switch's NetFlow / traffic-flow export at this host.</>
                  : <>Set <span className="font-mono">NETFLOW_ENABLED=true</span> and restart, then point a switch's export at <span className="font-mono">udp/{status?.port ?? 2055}</span>.</>}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                MikroTik: <span className="font-mono">/ip traffic-flow</span> (version 5 or 9). Cisco: a flow exporter to this host.
              </p>
              {canConfig && status?.enabled && (
                <p className="mt-2 text-xs text-slate-500">
                  Or select a device above and click <span className="font-medium">Enable export on this device</span> to configure it automatically.
                </p>
              )}
            </div>
          </Card>
        </div>
      ) : (
        <div className="space-y-5 px-6 pb-6">
          <Card title="Traffic over time">
            {seriesData.length === 0 ? <Empty /> : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={seriesData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="trafficFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0a6650" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#0a6650" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="bucket" tickFormatter={ts => fmtTime(ts, range)} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <YAxis tickFormatter={v => fmtBytes(v)} tick={{ fontSize: 11, fill: '#94a3b8' }} width={64} />
                  <Tooltip labelFormatter={ts => fmtTime(String(ts), range)} formatter={(v: number) => [fmtBytes(v), 'Bytes']} />
                  <Area type="monotone" dataKey="bytes" stroke="#0a6650" strokeWidth={2} fill="url(#trafficFill)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card title="Top talkers">
              {talkers.length === 0 ? <Empty /> : (
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-50">
                    {talkers.map(t => (
                      <tr key={t.host}>
                        <td className="py-1.5 pr-3 font-mono text-xs text-slate-700">{t.host}</td>
                        <td className="w-1/2 py-1.5">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                              <div className="h-full rounded-full bg-brand-500" style={{ width: `${Number(t.bytes) / talkerMax * 100}%` }} />
                            </div>
                            <span className="w-16 text-right tabular-nums text-slate-600">{fmtBytes(Number(t.bytes))}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card title="By application">
              {apps.length === 0 ? <Empty /> : (
                <div className="space-y-2">
                  {apps.map(a => (
                    <div key={a.app} className="flex items-center gap-2 text-sm">
                      <span className="w-20 shrink-0 capitalize text-slate-700">{a.app}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-brand-500" style={{ width: `${Number(a.bytes) / appMax * 100}%` }} />
                      </div>
                      <span className="w-16 text-right tabular-nums text-slate-500">{fmtBytes(Number(a.bytes))}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function Empty() {
  return <div className="py-10 text-center text-sm text-slate-400">No data in this range.</div>;
}
