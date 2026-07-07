import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, getToken } from '../api';
import { toast } from '../components/Toast';
import { useApiQuery } from '../hooks/useApiQuery';
import type { Me } from '../App';
import { PageHeader, Card, Button, StatusBadge, Modal, Field, inputCls, rowActionCls, fmtUptime } from '../components/ui';
import OnboardWizard from '../components/OnboardWizard';
import { useSiteScope, scoped } from '../context/SiteContext';


type SortKey = 'status' | 'hostname' | 'model' | 'mgmt_ip' | 'serial_number' | 'ios_version' | 'uptime_seconds' | 'cpu_pct' | 'mem_pct' | 'site_name';

export default function Devices({ me }: { me: Me }) {
  const [showAdd, setShowAdd] = useState(false);
  const [showCred, setShowCred] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('hostname');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const canEdit = me.role === 'superadmin' || me.role === 'netadmin';

  const { siteId } = useSiteScope();
  const { data: devices = [], refetch: load } = useApiQuery<any[]>(scoped('/api/devices', siteId), { refetchInterval: 30000 });
  const { data: sites = [] } = useApiQuery<any[]>('/api/sites');
  const { data: credentials = [], refetch: reloadCreds } = useApiQuery<any[]>('/api/credentials', { enabled: canEdit });

  // Download every device's latest config backup as one text file. Auth header
  // can't ride an <a href>, so fetch with the token and trigger a blob download.
  async function downloadBundle() {
    try {
      const res = await fetch('/api/config-bundle', { headers: { authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as any).error ?? res.statusText);
      const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/plain' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `switchpilot-configs-${new Date().toISOString().slice(0, 10)}.txt`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) { toast.error(err.message); }
  }

  // Filter + sort are pure client-side over the already-fetched list, so they're
  // instant and don't refire the query. Numeric columns sort numerically; the
  // rest case-insensitively, with nulls always sorted last.
  const numericKeys: SortKey[] = ['uptime_seconds', 'cpu_pct', 'mem_pct'];
  const q = search.trim().toLowerCase();
  const visible = devices
    .filter(d => !statusFilter || d.status === statusFilter)
    .filter(d => !q ||
      (d.hostname ?? '').toLowerCase().includes(q) ||
      (d.mgmt_ip ?? '').toLowerCase().includes(q) ||
      (d.model ?? '').toLowerCase().includes(q) ||
      (d.serial_number ?? '').toLowerCase().includes(q))
    .slice()
    .sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = numericKeys.includes(sortKey)
        ? Number(av) - Number(bv)
        : String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }
  const Th = ({ k, label, className = '' }: { k: SortKey; label: string; className?: string }) => (
    <th className={`pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500 ${className}`}>
      <button className="inline-flex items-center gap-1 hover:text-slate-700" onClick={() => toggleSort(k)}>
        {label}
        <span className="text-[9px] text-slate-400">{sortKey === k ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );

  return (
    <div>
      <PageHeader title="Devices">
        {canEdit && <Button variant="secondary" onClick={downloadBundle}>Download configs</Button>}
        {canEdit && <Button variant="secondary" onClick={() => setShowCred(true)}>Credentials</Button>}
        {canEdit && <Button onClick={() => setShowAdd(true)}>+ Add switch</Button>}
      </PageHeader>

      <div className="p-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input className={`${inputCls} max-w-xs`} value={search} onChange={e => setSearch(e.target.value)}
                 placeholder="Search hostname, IP, model, serial…" />
          <select className={`${inputCls} w-auto`} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
            <option value="unknown">Unknown</option>
          </select>
          {(search || statusFilter) && (
            <span className="text-xs text-slate-400">{visible.length} of {devices.length}</span>
          )}
        </div>
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left">
                  <Th k="status" label="Status" />
                  <Th k="hostname" label="Hostname" />
                  <Th k="model" label="Model" />
                  <Th k="mgmt_ip" label="IP" />
                  <Th k="serial_number" label="Serial" />
                  <Th k="ios_version" label="IOS" />
                  <Th k="uptime_seconds" label="Uptime" />
                  <Th k="cpu_pct" label="CPU" />
                  <Th k="mem_pct" label="Mem" />
                  <Th k="site_name" label="Site" className="pr-0" />
                  {canEdit && <th className="pb-3"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {visible.map(d => (
                  <tr key={d.id} className="group transition hover:bg-slate-50/80">
                    <td className="py-3 pr-4"><StatusBadge status={d.status} /></td>
                    <td className="py-3 pr-4">
                      <Link
                        className="font-medium text-brand-600 hover:text-brand-700 hover:underline"
                        to={`/devices/${d.id}`}
                      >
                        {d.hostname || d.mgmt_ip}
                      </Link>
                      {Array.isArray(d.stack_members) && d.stack_members.length > 1 && (
                        <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                          stack ×{d.stack_members.length}
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-slate-600">{d.model || '—'}</td>
                    <td className="py-3 pr-4 font-mono text-xs text-slate-500">{d.mgmt_ip}</td>
                    <td className="py-3 pr-4 font-mono text-xs text-slate-500">{d.serial_number || '—'}</td>
                    <td className="py-3 pr-4 text-slate-600">{d.ios_version || '—'}</td>
                    <td className="py-3 pr-4 text-slate-600">{fmtUptime(d.uptime_seconds)}</td>
                    <td className="py-3 pr-4">
                      {d.cpu_pct != null ? (
                        <span className={d.cpu_pct >= 90 ? 'font-medium text-red-600' : 'text-slate-600'}>
                          {d.cpu_pct}%
                        </span>
                      ) : '—'}
                    </td>
                    <td className="py-3 pr-4">
                      {d.mem_pct != null ? (
                        <span className={d.mem_pct >= 90 ? 'font-medium text-red-600' : 'text-slate-600'}>
                          {d.mem_pct}%
                        </span>
                      ) : '—'}
                    </td>
                    <td className="py-3 text-slate-600">{d.site_name ?? '—'}</td>
                    {canEdit && (
                      <td className="py-3 pl-2 text-right">
                        <button
                          className={`${rowActionCls} text-slate-300 opacity-0 transition hover:text-red-600 group-hover:opacity-100 max-lg:opacity-100 max-lg:text-slate-400`}
                          onClick={async () => {
                            if (!confirm(`Remove ${d.hostname || d.mgmt_ip} from SwitchPilot?\n\nThis deletes its history (ports, metrics, backups, alerts) from the platform. The switch itself is not touched.`)) return;
                            try { await api(`/api/devices/${d.id}`, { method: 'DELETE' }); load(); }
                            catch (err: any) { toast.error(err.message); }
                          }}>
                          remove
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {visible.length === 0 && devices.length > 0 && (
                  <tr>
                    <td colSpan={11} className="py-12 text-center text-sm text-slate-400">
                      No devices match the current filter.
                    </td>
                  </tr>
                )}
                {devices.length === 0 && (
                  <tr>
                    <td colSpan={11} className="py-12 text-center text-slate-400">
                      <div className="flex flex-col items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                             strokeWidth={1.5} stroke="currentColor" className="h-8 w-8 text-slate-300">
                          <path strokeLinecap="round" strokeLinejoin="round"
                                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                        <span className="text-sm">No devices yet.</span>
                        {canEdit && (
                          <span className="text-xs text-slate-400">
                            Add a credential profile, then add your first switch.
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {showAdd && (
        <OnboardWizard
          sites={sites}
          onClose={() => { setShowAdd(false); load(); }}
        />
      )}
      {showCred && (
        <CredentialManager
          credentials={credentials}
          onClose={() => { setShowCred(false); reloadCreds(); }}
        />
      )}
    </div>
  );
}

function CredentialManager({ credentials, onClose }: { credentials: any[]; onClose: () => void }) {
  const blank = { name: '', sshUsername: '', sshPassword: '', enablePassword: '', snmpVersion: '2c', snmpCommunity: '' };
  const [form, setForm] = useState<any>(blank);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function startEdit(c: any) {
    // Secrets are never returned by the API; leave them blank (blank = keep current).
    setEditingId(c.id);
    setForm({ name: c.name, sshUsername: c.ssh_username ?? '', snmpVersion: c.snmp_version ?? '2c',
              sshPassword: '', enablePassword: '', snmpCommunity: '' });
    setError('');
  }
  function cancelEdit() { setEditingId(null); setForm(blank); setError(''); }

  async function submit() {
    setBusy(true); setError('');
    try {
      if (editingId) {
        // Editing in place keeps devices attached; only send secrets the user
        // actually typed so a blank field doesn't blank the stored secret.
        const body: any = { name: form.name, sshUsername: form.sshUsername, snmpVersion: form.snmpVersion };
        for (const k of ['sshPassword', 'enablePassword', 'snmpCommunity'] as const) {
          if (form[k]) body[k] = form[k];
        }
        await api(`/api/credentials/${editingId}`, { method: 'PUT', body });
      } else {
        await api('/api/credentials', { method: 'POST', body: form });
      }
      onClose();
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal title="Credential profiles" onClose={onClose}>
      {credentials.length > 0 && (
        <ul className="mb-5 divide-y divide-slate-100 rounded-lg border border-slate-200 overflow-hidden">
          {credentials.map(c => (
            <li key={c.id} className="flex items-center justify-between px-4 py-3 text-sm bg-white hover:bg-slate-50">
              <div>
                <span className="font-medium text-slate-800">{c.name}</span>
                <span className="ml-2 text-slate-400">ssh: {c.ssh_username || '—'} · snmp v{c.snmp_version}</span>
              </div>
              <div className="flex items-center gap-3">
                <button className={`${rowActionCls} text-brand-600 hover:text-brand-700`} onClick={() => startEdit(c)}>Edit</button>
                <button
                  className={`${rowActionCls} text-red-500 hover:text-red-700`}
                  onClick={() => api(`/api/credentials/${c.id}`, { method: 'DELETE' }).then(onClose)
                    .catch((err: any) => toast.error(err.message))}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h3 className="mb-3 text-sm font-semibold text-slate-700">{editingId ? 'Edit profile' : 'New profile'}</h3>
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">
          {error}
        </div>
      )}

      <Field label="Profile name">
        <input className={inputCls} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="SSH username">
          <input className={inputCls} value={form.sshUsername} onChange={e => setForm({ ...form, sshUsername: e.target.value })} />
        </Field>
        <Field label={editingId ? 'SSH password (blank = keep)' : 'SSH password'}>
          <input type="password" className={inputCls} value={form.sshPassword} onChange={e => setForm({ ...form, sshPassword: e.target.value })} />
        </Field>
        <Field label={editingId ? 'Enable password (blank = keep)' : 'Enable password (optional)'}>
          <input type="password" className={inputCls} value={form.enablePassword} onChange={e => setForm({ ...form, enablePassword: e.target.value })} />
        </Field>
        <Field label={editingId ? 'SNMP community (blank = keep)' : 'SNMP community (v2c)'}>
          <input type="password" className={inputCls} value={form.snmpCommunity} onChange={e => setForm({ ...form, snmpCommunity: e.target.value })} />
        </Field>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        {editingId && <Button variant="secondary" onClick={cancelEdit}>Cancel edit</Button>}
        <Button variant="secondary" onClick={onClose}>Close</Button>
        <Button onClick={submit} disabled={busy || !form.name}>{editingId ? 'Update profile' : 'Save profile'}</Button>
      </div>
    </Modal>
  );
}
