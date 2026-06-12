import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useApiQuery } from '../hooks/useApiQuery';
import type { Me } from '../App';
import { PageHeader, Card, Button, StatusBadge, Modal, Field, inputCls, fmtUptime } from '../components/ui';
import OnboardWizard from '../components/OnboardWizard';


export default function Devices({ me }: { me: Me }) {
  const [showAdd, setShowAdd] = useState(false);
  const [showCred, setShowCred] = useState(false);
  const [showSites, setShowSites] = useState(false);
  const canEdit = me.role === 'superadmin' || me.role === 'netadmin';

  const { data: devices = [], refetch: load } = useApiQuery<any[]>('/api/devices', { refetchInterval: 30000 });
  const { data: sites = [], refetch: reloadSites } = useApiQuery<any[]>('/api/sites');
  const { data: credentials = [], refetch: reloadCreds } = useApiQuery<any[]>('/api/credentials', { enabled: canEdit });

  return (
    <div>
      <PageHeader title="Devices">
        {canEdit && <Button variant="secondary" onClick={() => setShowSites(true)}>Sites</Button>}
        {canEdit && <Button variant="secondary" onClick={() => setShowCred(true)}>Credentials</Button>}
        {canEdit && <Button onClick={() => setShowAdd(true)}>+ Add switch</Button>}
      </PageHeader>

      <div className="p-6">
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left">
                  <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                  <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Hostname</th>
                  <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Model</th>
                  <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">IP</th>
                  <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Serial</th>
                  <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">IOS</th>
                  <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Uptime</th>
                  <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">CPU</th>
                  <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Mem</th>
                  <th className="pb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Site</th>
                  {canEdit && <th className="pb-3"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {devices.map(d => (
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
                          className="text-xs text-slate-300 opacity-0 transition hover:text-red-600 hover:underline group-hover:opacity-100"
                          onClick={async () => {
                            if (!confirm(`Remove ${d.hostname || d.mgmt_ip} from SwitchPilot?\n\nThis deletes its history (ports, metrics, backups, alerts) from the platform. The switch itself is not touched.`)) return;
                            try { await api(`/api/devices/${d.id}`, { method: 'DELETE' }); load(); }
                            catch (err: any) { alert(err.message); }
                          }}>
                          remove
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {devices.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-slate-400">
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
      {showSites && (
        <SiteManager
          sites={sites}
          onChanged={reloadSites}
          onClose={() => { setShowSites(false); reloadSites(); }}
        />
      )}
    </div>
  );
}

function CredentialManager({ credentials, onClose }: { credentials: any[]; onClose: () => void }) {
  const [form, setForm] = useState<any>({
    name: '', sshUsername: '', sshPassword: '', enablePassword: '', snmpVersion: '2c', snmpCommunity: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setBusy(true); setError('');
    try {
      await api('/api/credentials', { method: 'POST', body: form });
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
              <button
                className="text-xs text-red-500 hover:text-red-700 hover:underline"
                onClick={() => api(`/api/credentials/${c.id}`, { method: 'DELETE' }).then(onClose)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3 className="mb-3 text-sm font-semibold text-slate-700">New profile</h3>
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
        <Field label="SSH password">
          <input type="password" className={inputCls} value={form.sshPassword} onChange={e => setForm({ ...form, sshPassword: e.target.value })} />
        </Field>
        <Field label="Enable password (optional)">
          <input type="password" className={inputCls} value={form.enablePassword} onChange={e => setForm({ ...form, enablePassword: e.target.value })} />
        </Field>
        <Field label="SNMP community (v2c)">
          <input type="password" className={inputCls} value={form.snmpCommunity} onChange={e => setForm({ ...form, snmpCommunity: e.target.value })} />
        </Field>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Close</Button>
        <Button onClick={submit} disabled={busy || !form.name}>Save profile</Button>
      </div>
    </Modal>
  );
}

function SiteManager({ sites, onChanged, onClose }: {
  sites: any[]; onChanged: () => void; onClose: () => void;
}) {
  const [editing, setEditing] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    if (!editing?.name?.trim()) return;
    setBusy(true); setError('');
    try {
      if (editing.id) {
        await api(`/api/sites/${editing.id}`, { method: 'PUT', body: { name: editing.name.trim(), address: editing.address ?? '' } });
      } else {
        await api('/api/sites', { method: 'POST', body: { name: editing.name.trim(), address: editing.address ?? '' } });
      }
      setEditing(null); onChanged();
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function remove(s: any) {
    if (!confirm(`Delete site "${s.name}"?`)) return;
    setError('');
    try { await api(`/api/sites/${s.id}`, { method: 'DELETE' }); onChanged(); }
    catch (err: any) { setError(err.message); }
  }

  return (
    <Modal title="Sites" onClose={onClose}>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-slate-500">Group devices by physical location. Assign a site when adding a switch.</p>
        <Button onClick={() => setEditing({ name: '', address: '' })}>Add site</Button>
      </div>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

      <table className="w-full text-sm">
        <thead><tr className="border-b text-left text-xs uppercase text-slate-500">
          <th className="py-1.5 pr-3">Name</th><th className="pr-3">Address</th><th></th></tr></thead>
        <tbody>
          {sites.map(s => (
            <tr key={s.id} className="border-b last:border-0">
              <td className="py-2 pr-3 font-medium text-slate-700">{s.name}</td>
              <td className="pr-3 text-slate-500">{s.address || '-'}</td>
              <td className="space-x-2 text-right">
                <button className="text-xs text-brand-600 hover:underline" onClick={() => setEditing({ ...s })}>edit</button>
                <button className="text-xs text-red-600 hover:underline" onClick={() => remove(s)}>delete</button>
              </td>
            </tr>
          ))}
          {sites.length === 0 && <tr><td colSpan={3} className="py-4 text-center text-slate-400">No sites yet</td></tr>}
        </tbody>
      </table>

      {editing && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">{editing.id ? 'Edit site' : 'New site'}</h3>
          <Field label="Name">
            <input className={inputCls} value={editing.name}
                   onChange={e => setEditing((p: any) => ({ ...p, name: e.target.value }))}
                   placeholder="e.g. HQ - Building A" autoFocus />
          </Field>
          <Field label="Address">
            <input className={inputCls} value={editing.address ?? ''}
                   onChange={e => setEditing((p: any) => ({ ...p, address: e.target.value }))} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={busy || !editing.name?.trim()}>{busy ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
