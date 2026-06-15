import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useSiteScope } from '../context/SiteContext';
import { PageHeader, Card } from '../components/ui';

interface SwitchMatch {
  device_id: string; hostname: string; mgmt_ip: string;
  model?: string; status?: string; site_name?: string;
}
interface NeighborMatch {
  neighbor_name: string; neighbor_ip?: string; neighbor_platform?: string;
  neighbor_port?: string; local_port?: string;
  device_id: string; switch_hostname: string; switch_ip?: string; site_name?: string;
}
interface ClientsResponse {
  endpoints: any[]; switches: SwitchMatch[]; neighbors: NeighborMatch[];
}

const EMPTY: ClientsResponse = { endpoints: [], switches: [], neighbors: [] };

export default function Clients() {
  const [query, setQuery] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [data, setData] = useState<ClientsResponse>(EMPTY);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { siteId } = useSiteScope();

  function search(q: string, active: boolean) {
    setLoading(true);
    const params = new URLSearchParams({ limit: '500' });
    if (q.trim()) params.set('q', q.trim());
    if (active) params.set('active', 'true');
    if (siteId) params.set('siteId', siteId);
    api<ClientsResponse>(`/api/clients?${params}`)
      .then(d => setData(d ?? EMPTY))
      .catch(() => setData(EMPTY))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query, activeOnly), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, activeOnly, siteId]);

  const { endpoints: results, switches, neighbors } = data;
  const hasInfra = !!query.trim() && (switches.length > 0 || neighbors.length > 0);

  const isRecent = (ts: string) =>
    Date.now() - new Date(ts).getTime() < 24 * 3600 * 1000;

  const [woke, setWoke] = useState('');
  const wake = async (mac: string) => {
    try {
      await api('/api/wol', { method: 'POST', body: { mac } });
      setWoke(mac); setTimeout(() => setWoke(''), 2500);
    } catch { /* surfaced by lack of confirmation */ }
  };

  const exportCsv = () => {
    const header = 'MAC,IP,Vendor,Hostname,Switch,Port,VLAN,First Seen,Last Seen';
    const rows = results.map(r => [
      r.mac, r.ip_address ?? '', r.vendor ?? '', r.ptr_hostname ?? '',
      r.hostname || r.mgmt_ip, r.port_name, r.vlan ?? '',
      new Date(r.first_seen).toISOString(), new Date(r.last_seen).toISOString()
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `endpoints-${new Date().toISOString().slice(0,10)}.csv`; a.click();
  };

  return (
    <div>
      <PageHeader title="Endpoint Inventory" />

      <div className="px-6 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            className="w-72 rounded-lg border border-slate-300 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            placeholder="Search MAC, IP, vendor, hostname, switch…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
          />
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={e => setActiveOnly(e.target.checked)}
              className="rounded border-slate-300"
            />
            Active only (24h)
          </label>
          {loading && <span className="text-xs text-slate-400">Searching…</span>}
          {results.length > 0 && (
            <button
              onClick={exportCsv}
              className="ml-auto rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition"
            >
              Export CSV
            </button>
          )}
        </div>
      </div>

      {/* Infrastructure matches: switches and CDP/LLDP neighbors the endpoint
          table can't represent. Only shown while searching. */}
      {hasInfra && (
        <div className="px-6 pb-2">
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Switches &amp; neighbors</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {switches.map(s => (
                <Link
                  key={`sw-${s.device_id}`}
                  to={`/devices/${s.device_id}`}
                  className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50 transition"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-green-700">Switch</span>
                      <span className="truncate text-sm font-medium text-slate-800">{s.hostname || s.mgmt_ip}</span>
                    </div>
                    <div className="mt-0.5 font-mono text-xs text-slate-400">{s.mgmt_ip}{s.model ? ` · ${s.model}` : ''}</div>
                  </div>
                  {s.site_name && <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{s.site_name}</span>}
                </Link>
              ))}
              {neighbors.map((n, i) => (
                <Link
                  key={`nb-${n.device_id}-${i}`}
                  to={`/devices/${n.device_id}`}
                  className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50 transition"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">Neighbor</span>
                      <span className="truncate text-sm font-medium text-slate-800">{n.neighbor_name}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-400 truncate">
                      {n.neighbor_ip && <span className="font-mono">{n.neighbor_ip}</span>}
                      {n.neighbor_platform && <span>{n.neighbor_ip ? ' · ' : ''}{n.neighbor_platform}</span>}
                      <span className="block">via {n.switch_hostname}{n.local_port ? ` ${n.local_port}` : ''}</span>
                    </div>
                  </div>
                  {n.site_name && <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{n.site_name}</span>}
                </Link>
              ))}
            </div>
          </Card>
        </div>
      )}

      <div className="px-6 pb-6 pt-2">
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left">
                  <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">MAC</th>
                  <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">IP</th>
                  <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Vendor</th>
                  <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Hostname</th>
                  <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Switch</th>
                  <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Port</th>
                  <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">VLAN</th>
                  <th className="pb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Last seen</th>
                  <th className="pb-3 text-xs font-semibold uppercase tracking-wide text-slate-500"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {results.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50/80 transition">
                    <td className="py-2.5 pr-4 font-mono text-xs text-slate-700 whitespace-nowrap">{r.mac}</td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-slate-600 whitespace-nowrap">{r.ip_address ?? '—'}</td>
                    <td className="py-2.5 pr-4 text-xs text-slate-600">
                      {r.vendor
                        ? <span className="inline-block bg-slate-100 rounded px-1.5 py-0.5 text-[11px] font-medium">{r.vendor}</span>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-slate-500 max-w-32 truncate" title={r.ptr_hostname ?? undefined}>
                      {r.ptr_hostname ?? '—'}
                    </td>
                    <td className="py-2.5 pr-4">
                      <Link to={`/devices/${r.device_id}`} className="text-xs font-medium text-brand-600 hover:underline">
                        {r.hostname || r.mgmt_ip}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className="font-mono text-xs text-slate-600">{r.port_name}</span>
                      {r.port_description && (
                        <span className="ml-1 text-xs text-slate-400">— {r.port_description}</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-slate-600">{r.vlan ?? '—'}</td>
                    <td className="py-2.5 text-xs whitespace-nowrap">
                      <span className={isRecent(r.last_seen) ? 'font-medium text-green-700' : 'text-slate-500'}>
                        {new Date(r.last_seen).toLocaleString()}
                      </span>
                    </td>
                    <td className="py-2.5 pl-3 text-right">
                      <button onClick={() => wake(r.mac)} title="Send a Wake-on-LAN magic packet to this MAC"
                        className="rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-50 hover:text-brand-600 transition">
                        {woke === r.mac ? 'Sent ✓' : 'Wake'}
                      </button>
                    </td>
                  </tr>
                ))}
                {results.length === 0 && !loading && (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-400">
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-sm">
                          {query
                            ? (hasInfra ? 'No endpoints matched, but see switch/neighbor matches above.' : 'No endpoints matched your search.')
                            : 'No endpoint data yet.'}
                        </span>
                        {!query && <span className="text-xs">Records appear after the first device refresh.</span>}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {results.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-400">
              {results.length} endpoint{results.length !== 1 ? 's' : ''}
              {activeOnly ? ' active in the last 24 hours' : ''}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
