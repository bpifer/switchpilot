import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Me } from '../App';
import { PageHeader, Card, Button, StatusBadge, Modal, Field, inputCls, fmtUptime } from '../components/ui';

const CISCO_MODELS = [
  {
    family: 'Catalyst 2960',
    models: [
      'WS-C2960-24TT-L', 'WS-C2960-48TT-L',
      'WS-C2960+24PC-L', 'WS-C2960+48PST-L',
      'WS-C2960X-24PD-L', 'WS-C2960X-48FPD-L', 'WS-C2960X-48LPD-L',
      'WS-C2960XR-24PD-I', 'WS-C2960XR-48FPD-I',
    ],
  },
  {
    family: 'Catalyst 3560',
    models: [
      'WS-C3560-24PS-S', 'WS-C3560-48PS-S',
      'WS-C3560X-24P-S', 'WS-C3560X-48P-S',
      'WS-C3560CX-8PC-S', 'WS-C3560CX-12PD-S',
    ],
  },
  {
    family: 'Catalyst 3750',
    models: [
      'WS-C3750X-24P-S', 'WS-C3750X-48P-S',
      'WS-C3750X-24PF-S', 'WS-C3750X-48PF-S',
    ],
  },
  {
    family: 'Catalyst 9200',
    models: [
      'C9200-24P', 'C9200-24T',
      'C9200-48P', 'C9200-48T',
      'C9200L-24P-4G', 'C9200L-48P-4G',
    ],
  },
  {
    family: 'Catalyst 9300',
    models: [
      'C9300-24P', 'C9300-24T',
      'C9300-48P', 'C9300-48T', 'C9300-48UXM',
      'C9300L-24P-4G', 'C9300L-48P-4G',
    ],
  },
  {
    family: 'Catalyst 9400',
    models: ['C9404R', 'C9407R', 'C9410R'],
  },
];

export default function Devices({ me }: { me: Me }) {
  const [devices, setDevices] = useState<any[]>([]);
  const [credentials, setCredentials] = useState<any[]>([]);
  const [sites, setSites] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showCred, setShowCred] = useState(false);
  const canEdit = me.role === 'superadmin' || me.role === 'netadmin';

  const load = () => api('/api/devices').then(setDevices).catch(() => {});
  useEffect(() => {
    load();
    api('/api/sites').then(setSites).catch(() => {});
    if (canEdit) api('/api/credentials').then(setCredentials).catch(() => {});
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  return (
    <div>
      <PageHeader title="Devices">
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
        <AddDevice
          credentials={credentials}
          sites={sites}
          onClose={() => { setShowAdd(false); load(); }}
        />
      )}
      {showCred && (
        <CredentialManager
          credentials={credentials}
          onClose={() => {
            setShowCred(false);
            api('/api/credentials').then(setCredentials).catch(() => {});
          }}
        />
      )}
    </div>
  );
}

function AddDevice({ credentials, sites, onClose }: { credentials: any[]; sites: any[]; onClose: () => void }) {
  const [form, setForm] = useState<any>({
    mgmtIp: '', credentialId: credentials[0]?.id ?? '', model: '', location: '', siteId: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setBusy(true); setError('');
    try {
      const body: any = { mgmtIp: form.mgmtIp, credentialId: form.credentialId };
      if (form.model)    body.model    = form.model;
      if (form.location) body.location = form.location;
      if (form.siteId)   body.siteId   = form.siteId;
      await api('/api/devices', { method: 'POST', body });
      onClose();
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal title="Add switch" onClose={onClose}>
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">
          {error}
        </div>
      )}

      <Field label="Management IP">
        <input
          className={inputCls}
          value={form.mgmtIp}
          onChange={e => setForm({ ...form, mgmtIp: e.target.value })}
          placeholder="10.0.0.10"
        />
      </Field>

      <Field label="Credential profile">
        <select
          className={inputCls}
          value={form.credentialId}
          onChange={e => setForm({ ...form, credentialId: e.target.value })}
        >
          {credentials.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          {credentials.length === 0 && (
            <option value="">— create a credential profile first —</option>
          )}
        </select>
      </Field>

      <Field label="Model">
        <select
          className={inputCls}
          value={form.model}
          onChange={e => setForm({ ...form, model: e.target.value })}
        >
          <option value="">— Auto-detect via SSH / SNMP —</option>
          {CISCO_MODELS.map(group => (
            <optgroup key={group.family} label={group.family}>
              {group.models.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </optgroup>
          ))}
        </select>
        {!form.model && (
          <p className="mt-1 text-xs text-slate-400">
            Leave on auto-detect if unsure — the platform will identify the model via SSH.
          </p>
        )}
      </Field>

      <Field label="Site">
        <select
          className={inputCls}
          value={form.siteId}
          onChange={e => setForm({ ...form, siteId: e.target.value })}
        >
          <option value="">—</option>
          {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Field>

      <Field label="Location">
        <input
          className={inputCls}
          value={form.location}
          onChange={e => setForm({ ...form, location: e.target.value })}
          placeholder="IDF-2, rack 4"
        />
      </Field>

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={busy || !form.mgmtIp || !form.credentialId}>
          {busy ? 'Onboarding…' : 'Add switch'}
        </Button>
      </div>
    </Modal>
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
