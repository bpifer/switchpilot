import { useState } from 'react';
import { api } from '../api';

interface LocateResult {
  match_type: 'mac' | 'ip' | 'hostname' | 'neighbor' | 'device_ip';
  device_id?: string;
  switch_hostname?: string;
  switch_ip?: string;
  port_name?: string;
  port_description?: string;
  vlan?: number;
  mac?: string;
  ip_address?: string;
  last_seen?: string;
  site_name?: string;
  neighbor_name?: string;
  neighbor_port?: string;
  neighbor_ip?: string;
  neighbor_platform?: string;
  model?: string;
  status?: string;
}

const MATCH_LABEL: Record<string, { label: string; color: string }> = {
  mac:       { label: 'MAC match',      color: 'text-violet-600 bg-violet-50' },
  ip:        { label: 'IP match',       color: 'text-blue-600 bg-blue-50' },
  hostname:  { label: 'Switch',         color: 'text-green-600 bg-green-50' },
  neighbor:  { label: 'Neighbor device', color: 'text-amber-600 bg-amber-50' },
  device_ip: { label: 'Switch IP',      color: 'text-blue-600 bg-blue-50' },
};

export default function Locate() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<LocateResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    const term = q.trim();
    if (!term) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api<LocateResult[]>(`/api/locate?q=${encodeURIComponent(term)}`);
      setResults(data);
    } catch {
      setError('Search failed — check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-slate-800">Endpoint Locator</h1>
        <p className="mt-1 text-sm text-slate-500">
          Search by IP address, MAC address, or hostname to find where a device is connected.
        </p>
      </div>

      <div className="flex gap-2 mb-8">
        <input
          type="text"
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
          placeholder="10.0.1.100  ·  aabb.cc00.0100  ·  hostname"
          className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200 placeholder:text-slate-400"
          autoFocus
        />
        <button
          onClick={search}
          disabled={loading || !q.trim()}
          className="rounded-lg bg-brand-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Searching…' : 'Locate'}
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-4">
          {error}
        </div>
      )}

      {results !== null && results.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-slate-200 p-12 text-center">
          <p className="text-slate-400 text-sm">No results for <span className="font-mono font-medium text-slate-600">{q}</span></p>
          <p className="text-slate-400 text-xs mt-1">Try a different format — Cisco MAC (aabb.cc00.0100), colon (aa:bb:cc:00:01:00), or partial hostname.</p>
        </div>
      )}

      {results && results.length > 0 && (
        <div className="space-y-4">
          {results.map((r, i) => {
            const badge = MATCH_LABEL[r.match_type] ?? { label: r.match_type, color: 'text-slate-600 bg-slate-100' };
            const title = r.match_type === 'neighbor' ? r.neighbor_name : r.switch_hostname;
            return (
              <div key={i} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${badge.color}`}>
                      {badge.label}
                    </span>
                    <h3 className="mt-1.5 text-base font-semibold text-slate-800">
                      {title ?? '—'}
                      {r.switch_ip && r.match_type !== 'neighbor' && (
                        <span className="ml-2 text-sm font-normal text-slate-400 font-mono">{r.switch_ip}</span>
                      )}
                    </h3>
                    {r.match_type === 'neighbor' && r.switch_hostname && (
                      <p className="text-xs text-slate-500 mt-0.5">
                        Seen by <span className="font-medium">{r.switch_hostname}</span>
                        {r.switch_ip && <span className="font-mono ml-1 text-slate-400">{r.switch_ip}</span>}
                      </p>
                    )}
                  </div>
                  {r.site_name && (
                    <span className="shrink-0 text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full font-medium">
                      {r.site_name}
                    </span>
                  )}
                </div>

                <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                  {r.port_name && (
                    <Field label="Port" value={r.port_description ? `${r.port_name} — ${r.port_description}` : r.port_name} />
                  )}
                  {r.vlan != null && <Field label="VLAN" value={String(r.vlan)} />}
                  {r.mac && <Field label="MAC" value={r.mac} mono />}
                  {r.ip_address && <Field label="IP Address" value={r.ip_address} mono />}
                  {r.neighbor_name && r.match_type !== 'neighbor' && (
                    <Field
                      label="CDP/LLDP Neighbor"
                      value={r.neighbor_port ? `${r.neighbor_name} (${r.neighbor_port})` : r.neighbor_name}
                    />
                  )}
                  {r.neighbor_ip && r.match_type !== 'neighbor' && (
                    <Field label="Neighbor IP" value={r.neighbor_ip} mono />
                  )}
                  {r.neighbor_platform && r.match_type === 'neighbor' && (
                    <Field label="Platform" value={r.neighbor_platform} />
                  )}
                  {r.neighbor_port && r.match_type === 'neighbor' && (
                    <Field label="Connected via" value={`${r.switch_hostname} ${r.port_name ?? ''}`} />
                  )}
                  {r.model && <Field label="Model" value={r.model} />}
                  {r.status && (
                    <div>
                      <dt className="text-xs text-slate-400 mb-0.5">Status</dt>
                      <dd>
                        <span className={`inline-flex items-center gap-1 text-xs font-medium ${
                          r.status === 'online' ? 'text-green-600' : r.status === 'offline' ? 'text-red-600' : 'text-slate-600'
                        }`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${
                            r.status === 'online' ? 'bg-green-500' : r.status === 'offline' ? 'bg-red-500' : 'bg-slate-400'
                          }`} />
                          {r.status}
                        </span>
                      </dd>
                    </div>
                  )}
                  {r.last_seen && (
                    <Field label="Last seen" value={new Date(r.last_seen).toLocaleString()} />
                  )}
                </dl>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-slate-400 mb-0.5">{label}</dt>
      <dd className={`text-slate-700 font-medium truncate ${mono ? 'font-mono text-xs' : 'text-sm'}`}>{value}</dd>
    </div>
  );
}
