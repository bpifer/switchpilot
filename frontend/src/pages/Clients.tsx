import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useApiQuery } from '../hooks/useApiQuery';
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
  const [debounced, setDebounced] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [vlanFilter, setVlanFilter] = useState('');
  const { siteId } = useSiteScope();

  // Debounce the text input into the query path so keystrokes don't each fire a
  // request; the query itself now shares react-query's cache + WS invalidation.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const params = new URLSearchParams({ limit: '500' });
  if (debounced) params.set('q', debounced);
  if (activeOnly) params.set('active', 'true');
  if (siteId) params.set('siteId', siteId);
  const { data = EMPTY, isFetching } = useApiQuery<ClientsResponse>(`/api/clients?${params}`);

  const { endpoints: allResults, switches, neighbors } = data;
  // VLAN filter is client-side over the fetched endpoints; the dropdown lists
  // the distinct VLANs actually present in the current result set.
  const vlans = useMemo(
    () => [...new Set(allResults.map(r => String(r.vlan ?? '')).filter(v => v !== ''))]
      .sort((a, b) => Number(a) - Number(b)),
    [allResults]);
  const results = vlanFilter ? allResults.filter(r => String(r.vlan ?? '') === vlanFilter) : allResults;
  const hasInfra = !!debounced && (switches.length > 0 || neighbors.length > 0);

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
            className="w-72 rounded-lg border border-slate-300 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:ring-brand-400/30"
            placeholder="Search MAC, IP, vendor, hostname, switch…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
          />
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={e => setActiveOnly(e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-600"
            />
            Active only (24h)
          </label>
          {vlans.length > 0 && (
            <select
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              value={vlanFilter}
              onChange={e => setVlanFilter(e.target.value)}
            >
              <option value="">All VLANs</option>
              {vlans.map(v => <option key={v} value={v}>VLAN {v}</option>)}
            </select>
          )}
          {isFetching && <span className="text-xs text-slate-400 dark:text-slate-500">Searching…</span>}
          {results.length > 0 && (
            <button
              onClick={exportCsv}
              className="ml-auto rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-800/50"
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
            <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Switches &amp; neighbors</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {switches.map(s => (
                <Link
                  key={`sw-${s.device_id}`}
                  to={`/devices/${s.device_id}`}
                  className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50 transition dark:border-slate-700 dark:hover:bg-slate-800/50"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-green-700 dark:bg-green-500/10 dark:text-green-400">Switch</span>
                      <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{s.hostname || s.mgmt_ip}</span>
                    </div>
                    <div className="mt-0.5 font-mono text-xs text-slate-400 dark:text-slate-500">{s.mgmt_ip}{s.model ? ` · ${s.model}` : ''}</div>
                  </div>
                  {s.site_name && <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-slate-700/50 dark:text-slate-400">{s.site_name}</span>}
                </Link>
              ))}
              {neighbors.map((n, i) => (
                <Link
                  key={`nb-${n.device_id}-${i}`}
                  to={`/devices/${n.device_id}`}
                  className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50 transition dark:border-slate-700 dark:hover:bg-slate-800/50"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">Neighbor</span>
                      <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{n.neighbor_name}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-400 truncate dark:text-slate-500">
                      {n.neighbor_ip && <span className="font-mono">{n.neighbor_ip}</span>}
                      {n.neighbor_platform && <span>{n.neighbor_ip ? ' · ' : ''}{n.neighbor_platform}</span>}
                      <span className="block">via {n.switch_hostname}{n.local_port ? ` ${n.local_port}` : ''}</span>
                    </div>
                  </div>
                  {n.site_name && <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-slate-700/50 dark:text-slate-400">{n.site_name}</span>}
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
                <tr className="border-b border-slate-100 text-left dark:border-slate-800">
                  <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">MAC</th>
                  <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">IP</th>
                  <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Vendor</th>
                  <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Hostname</th>
                  <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Switch</th>
                  <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Port</th>
                  <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">VLAN</th>
                  <th className="pb-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Last seen</th>
                  <th className="pb-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {results.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50/80 transition dark:hover:bg-slate-800/60">
                    <td className="py-2.5 pr-4 font-mono text-xs text-slate-700 whitespace-nowrap dark:text-slate-300">{r.mac}</td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-slate-600 whitespace-nowrap dark:text-slate-400">{r.ip_address ?? '—'}</td>
                    <td className="py-2.5 pr-4 text-xs text-slate-600 dark:text-slate-400">
                      {r.vendor
                        ? <span className="inline-block bg-slate-100 rounded px-1.5 py-0.5 text-[11px] font-medium dark:bg-slate-700/50">{r.vendor}</span>
                        : <span className="text-slate-300 dark:text-slate-600">—</span>}
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-slate-500 max-w-32 truncate dark:text-slate-400" title={r.ptr_hostname ?? undefined}>
                      {r.ptr_hostname ?? '—'}
                    </td>
                    <td className="py-2.5 pr-4">
                      <Link to={`/devices/${r.device_id}`} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                        {r.hostname || r.mgmt_ip}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className="font-mono text-xs text-slate-600 dark:text-slate-400">{r.port_name}</span>
                      {r.port_description && (
                        <span className="ml-1 text-xs text-slate-400 dark:text-slate-500">— {r.port_description}</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-slate-600 dark:text-slate-400">{r.vlan ?? '—'}</td>
                    <td className="py-2.5 text-xs whitespace-nowrap">
                      <span className={isRecent(r.last_seen) ? 'font-medium text-green-700 dark:text-green-400' : 'text-slate-500 dark:text-slate-400'}>
                        {new Date(r.last_seen).toLocaleString()}
                      </span>
                    </td>
                    <td className="py-2.5 pl-3 text-right">
                      <button onClick={() => wake(r.mac)} title="Send a Wake-on-LAN magic packet to this MAC"
                        className="rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-50 hover:text-brand-600 transition dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-brand-400">
                        {woke === r.mac ? 'Sent ✓' : 'Wake'}
                      </button>
                    </td>
                  </tr>
                ))}
                {results.length === 0 && !isFetching && (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-400 dark:text-slate-500">
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
            <div className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
              {results.length} endpoint{results.length !== 1 ? 's' : ''}
              {activeOnly ? ' active in the last 24 hours' : ''}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
