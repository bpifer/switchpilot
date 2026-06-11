import { useEffect, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer
} from 'recharts';
import { api } from '../api';
import { PageHeader, Card } from '../components/ui';

type Range = '7d' | '30d' | '90d' | '1y';

const RANGES: { value: Range; label: string }[] = [
  { value: '7d',  label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '1y',  label: '1 year' },
];

function fmtBucket(ts: string, range: Range): string {
  const d = new Date(ts);
  if (range === '1y' || range === '90d')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (range === '30d')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
  return d.toLocaleTimeString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
}

function fmtBps(bps: number | null): string {
  if (bps === null || bps === undefined) return '—';
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(1)} Gbps`;
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)} Mbps`;
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(0)} Kbps`;
  return `${bps} bps`;
}

const CHART_COLORS = {
  cpu:    '#0a6650',
  memory: '#3b82f6',
  temp:   '#f59e0b',
  poe:    '#8b5cf6',
  in:     '#10b981',
  out:    '#f97316',
};

export default function Analytics() {
  const [devices, setDevices] = useState<any[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [range, setRange] = useState<Range>('7d');

  const [cpuData,  setCpuData]  = useState<any[]>([]);
  const [memData,  setMemData]  = useState<any[]>([]);
  const [tempData, setTempData] = useState<any[]>([]);
  const [poeData,  setPoeData]  = useState<any[]>([]);

  const [ports,    setPorts]    = useState<string[]>([]);
  const [portName, setPortName] = useState('');
  const [portData, setPortData] = useState<any[]>([]);

  useEffect(() => {
    api('/api/devices').then((ds: any[]) => {
      setDevices(ds);
      if (ds.length > 0) setDeviceId(ds[0].id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!deviceId) return;
    const load = (metric: string) =>
      api(`/api/analytics/device/${deviceId}?metric=${metric}&range=${range}`).catch(() => []);

    Promise.all([load('cpu'), load('memory'), load('temp'), load('poe_used')])
      .then(([cpu, mem, temp, poe]) => {
        setCpuData(cpu);
        setMemData(mem);
        setTempData(temp);
        setPoeData(poe);
      });

    api(`/api/analytics/port/${deviceId}`).then((ps: string[]) => {
      setPorts(ps);
      if (ps.length > 0 && !portName) setPortName(ps[0]);
    }).catch(() => {});
  }, [deviceId, range]);

  useEffect(() => {
    if (!deviceId || !portName) return;
    api(`/api/analytics/port/${deviceId}/${encodeURIComponent(portName)}?range=${range}`)
      .then(setPortData)
      .catch(() => {});
  }, [deviceId, portName, range]);

  function chartFmt(ts: string) { return fmtBucket(ts, range); }

  const cpuMemMerged = (() => {
    const map = new Map<string, any>();
    for (const d of cpuData) map.set(d.bucket, { bucket: d.bucket, cpu: d.value });
    for (const d of memData) {
      const e = map.get(d.bucket) ?? { bucket: d.bucket };
      map.set(d.bucket, { ...e, mem: d.value });
    }
    return Array.from(map.values()).sort((a, b) => a.bucket.localeCompare(b.bucket));
  })();

  return (
    <div>
      <PageHeader title="Analytics" />

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4 px-6 py-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-600">Device</label>
          <select
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
            value={deviceId}
            onChange={e => setDeviceId(e.target.value)}
          >
            {devices.map(d => (
              <option key={d.id} value={d.id}>{d.hostname || d.mgmt_ip}</option>
            ))}
          </select>
        </div>
        <div className="flex rounded-lg border border-slate-200 bg-white overflow-hidden">
          {RANGES.map(r => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              className={`px-3 py-1.5 text-sm transition ${
                range === r.value
                  ? 'bg-brand-600 text-white font-medium'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-5 px-6 pb-6">
        {/* CPU & Memory */}
        <Card title="CPU & Memory (%)">
          <EmptyOrChart data={cpuMemMerged} message="No CPU/memory data yet — data accumulates after first device refresh.">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={cpuMemMerged} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="bucket" tickFormatter={chartFmt} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#94a3b8' }} unit="%" />
                <Tooltip labelFormatter={chartFmt} formatter={(v: number) => [`${v}%`]} />
                <Legend />
                <Line type="monotone" dataKey="cpu" name="CPU"    stroke={CHART_COLORS.cpu}    dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="mem" name="Memory" stroke={CHART_COLORS.memory} dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </EmptyOrChart>
        </Card>

        {/* Temperature */}
        <Card title="Temperature (°C)">
          <EmptyOrChart data={tempData} message="No temperature data — not all switch models expose a temperature sensor.">
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={tempData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="bucket" tickFormatter={chartFmt} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} unit="°C" />
                <Tooltip labelFormatter={chartFmt} formatter={(v: number) => [`${v}°C`]} />
                <Line type="monotone" dataKey="value" name="Temp" stroke={CHART_COLORS.temp} dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </EmptyOrChart>
        </Card>

        {/* PoE */}
        <Card title="PoE usage (W)">
          <EmptyOrChart data={poeData} message="No PoE data — switch may not support PoE or data hasn't accumulated yet.">
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={poeData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="bucket" tickFormatter={chartFmt} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} unit=" W" />
                <Tooltip labelFormatter={chartFmt} formatter={(v: number) => [`${v} W`]} />
                <Line type="monotone" dataKey="value" name="PoE used" stroke={CHART_COLORS.poe} dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </EmptyOrChart>
        </Card>

        {/* Port bandwidth */}
        <Card title="Port bandwidth">
          {ports.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">
              No port bandwidth data yet — accumulates after first refresh with connected ports.
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-center gap-2">
                <label className="text-sm font-medium text-slate-600">Port</label>
                <select
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
                  value={portName}
                  onChange={e => setPortName(e.target.value)}
                >
                  {ports.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <EmptyOrChart data={portData} message="No data for this port in the selected range.">
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={portData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="bucket" tickFormatter={chartFmt} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }}
                           tickFormatter={v => fmtBps(v)} />
                    <Tooltip labelFormatter={chartFmt}
                             formatter={(v: number) => [fmtBps(v)]} />
                    <Legend />
                    <Line type="monotone" dataKey="in_bps"  name="In"  stroke={CHART_COLORS.in}  dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="out_bps" name="Out" stroke={CHART_COLORS.out} dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </EmptyOrChart>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function EmptyOrChart({ data, message, children }: {
  data: any[]; message: string; children: React.ReactNode;
}) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center py-10 text-sm text-slate-400">
        {message}
      </div>
    );
  }
  return <>{children}</>;
}
