import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApiQuery } from '../hooks/useApiQuery';
import { useSiteScope } from '../context/SiteContext';
import { PageHeader, Card, Button, inputCls } from '../components/ui';

const SEV: { name: string; cls: string }[] = [
  { name: 'emerg',  cls: 'bg-red-100 text-red-800 dark:bg-red-500/10 dark:text-red-400' },
  { name: 'alert',  cls: 'bg-red-100 text-red-800 dark:bg-red-500/10 dark:text-red-400' },
  { name: 'crit',   cls: 'bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400' },
  { name: 'error',  cls: 'bg-orange-100 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400' },
  { name: 'warn',   cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400' },
  { name: 'notice', cls: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400' },
  { name: 'info',   cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-400' },
  { name: 'debug',  cls: 'bg-slate-100 text-slate-400 dark:bg-slate-700/50 dark:text-slate-500' },
];

export default function Logs() {
  const [deviceId, setDeviceId] = useState('');
  const [severity, setSeverity] = useState('7');
  const [q, setQ] = useState('');

  const { siteId } = useSiteScope();
  const params = new URLSearchParams();
  if (deviceId) params.set('deviceId', deviceId);
  if (siteId) params.set('siteId', siteId);
  if (severity !== '7') params.set('severity', severity);
  if (q.trim()) params.set('q', q.trim());
  params.set('limit', '300');

  const { data: logs = [], isLoading } = useApiQuery<any[]>(`/api/logs?${params}`, { refetchInterval: 10000 });
  const { data: devices = [] } = useApiQuery<any[]>(siteId ? `/api/devices?siteId=${siteId}` : '/api/devices');

  function exportCsv() {
    const esc = (v: string) => `"${(v ?? '').replace(/"/g, '""')}"`;
    const header = 'Time,Device,Source IP,Severity,Message';
    const rows = logs.map(l => [
      new Date(l.received_at).toISOString(),
      l.hostname ?? '',
      l.source_ip ?? '',
      l.severity != null ? (SEV[l.severity]?.name ?? l.severity) : '',
      l.message ?? ''
    ].map(esc).join(','));
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `syslog-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PageHeader title="Logs">
        <Button variant="secondary" onClick={exportCsv} disabled={logs.length === 0}>Export CSV</Button>
      </PageHeader>
      <div className="p-6">
        <Card>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <select className={`${inputCls} !w-56`} value={deviceId} onChange={e => setDeviceId(e.target.value)}>
              <option value="">All devices</option>
              {devices.map(d => <option key={d.id} value={d.id}>{d.hostname || d.mgmt_ip}</option>)}
            </select>
            <select className={`${inputCls} !w-44`} value={severity} onChange={e => setSeverity(e.target.value)}>
              <option value="7">All severities</option>
              <option value="6">Info and above</option>
              <option value="5">Notice and above</option>
              <option value="4">Warning and above</option>
              <option value="3">Error and above</option>
              <option value="2">Critical and above</option>
            </select>
            <input className={`${inputCls} !w-72`} value={q} onChange={e => setQ(e.target.value)}
                   placeholder="Search message text…" />
            <span className="ml-auto text-xs text-slate-400 dark:text-slate-500">auto-refreshes every 10s · 14-day retention</span>
          </div>

          {isLoading ? (
            <p className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</p>
          ) : logs.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400 dark:text-slate-500">
              No log messages{deviceId || q ? ' matching the filters' : ''} yet.
              <p className="mt-1 text-xs">
                Switches must forward syslog here - apply the baseline config from the device page
                (adds <span className="font-mono">logging host</span>) if you haven't.
              </p>
            </div>
          ) : (
            <div className="max-h-[70vh] overflow-auto font-mono text-xs">
              <table className="w-full">
                <tbody>
                  {logs.map(l => {
                    const sev = l.severity != null ? SEV[l.severity] : null;
                    return (
                      <tr key={l.id} className="border-b border-slate-50 align-top last:border-0 hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                        <td className="whitespace-nowrap py-1.5 pr-3 text-slate-400 dark:text-slate-500">
                          {new Date(l.received_at).toLocaleString()}
                        </td>
                        <td className="whitespace-nowrap py-1.5 pr-3">
                          {l.device_id
                            ? <Link className="text-brand-600 hover:underline dark:text-brand-400" to={`/devices/${l.device_id}`}>{l.hostname}</Link>
                            : <span className="text-slate-400 dark:text-slate-500">{l.source_ip}</span>}
                        </td>
                        <td className="whitespace-nowrap py-1.5 pr-3">
                          {sev && (
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${sev.cls}`}>
                              {sev.name}
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 text-slate-700 dark:text-slate-300">{l.message}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
