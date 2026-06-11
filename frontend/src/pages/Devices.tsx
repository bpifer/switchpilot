import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Me } from '../App';
import { PageHeader, Card, Button, StatusBadge, Modal, Field, inputCls, fmtUptime } from '../components/ui';

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
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-gray-500">
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Hostname</th>
                <th className="py-2 pr-4">Model</th>
                <th className="py-2 pr-4">IP</th>
                <th className="py-2 pr-4">Serial</th>
                <th className="py-2 pr-4">IOS</th>
                <th className="py-2 pr-4">Uptime</th>
                <th className="py-2 pr-4">CPU</th>
                <th className="py-2 pr-4">Mem</th>
                <th className="py-2 pr-4">Site</th>
              </tr>
            </thead>
            <tbody>
              {devices.map(d => (
                <tr key={d.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="py-2 pr-4"><StatusBadge status={d.status} /></td>
                  <td className="py-2 pr-4">
                    <Link className="font-medium text-brand-600 hover:underline" to={`/devices/${d.id}`}>
                      {d.hostname || d.mgmt_ip}
                    </Link>
                    {Array.isArray(d.stack_members) && d.stack_members.length > 1 &&
                      <span className="ml-2 rounded bg-gray-100 px-1.5 text-xs text-gray-600">stack ×{d.stack_members.length}</span>}
                  </td>
                  <td className="py-2 pr-4">{d.model || '—'}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{d.mgmt_ip}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{d.serial_number || '—'}</td>
                  <td className="py-2 pr-4">{d.ios_version || '—'}</td>
                  <td className="py-2 pr-4">{fmtUptime(d.uptime_seconds)}</td>
                  <td className="py-2 pr-4">{d.cpu_pct != null ? `${d.cpu_pct}%` : '—'}</td>
                  <td className="py-2 pr-4">{d.mem_pct != null ? `${d.mem_pct}%` : '—'}</td>
                  <td className="py-2 pr-4">{d.site_name ?? '—'}</td>
                </tr>
              ))}
              {devices.length === 0 && (
                <tr><td colSpan={10} className="py-8 text-center text-gray-400">
                  No devices yet. {canEdit ? 'Add a credential profile, then add your first switch.' : ''}
                </td></tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>
      {showAdd && <AddDevice credentials={credentials} sites={sites} onClose={() => { setShowAdd(false); load(); }} />}
      {showCred && <CredentialManager credentials={credentials}
                                      onClose={() => { setShowCred(false); api('/api/credentials').then(setCredentials).catch(() => {}); }} />}
    </div>
  );
}

function AddDevice({ credentials, sites, onClose }: { credentials: any[]; sites: any[]; onClose: () => void }) {
  const [form, setForm] = useState<any>({ mgmtIp: '', credentialId: credentials[0]?.id ?? '', model: '', location: '', siteId: '' });
  const [families, setFamilies] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api('/api/families').then(setFamilies).catch(() => {}); }, []);

  async function submit() {
    setBusy(true); setError('');
    try {
      const body: any = { mgmtIp: form.mgmtIp, credentialId: form.credentialId };
      if (form.model) body.model = form.model;
      if (form.location) body.location = form.location;
      if (form.siteId) body.siteId = form.siteId;
      await api('/api/devices', { method: 'POST', body });
      onClose();
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <Modal title="Add switch" onClose={onClose}>
      {error && <div className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <Field label="Management IP">
        <input className={inputCls} value={form.mgmtIp} onChange={e => setForm({ ...form, mgmtIp: e.target.value })} placeholder="10.0.0.10" />
      </Field>
      <Field label="Credential profile">
        <select className={inputCls} value={form.credentialId} onChange={e => setForm({ ...form, credentialId: e.target.value })}>
          {credentials.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          {credentials.length === 0 && <option value="">— create a credential profile first —</option>}
        </select>
      </Field>
      <Field label="Model (leave blank to auto-detect via SSH/SNMP)">
        <input className={inputCls} value={form.model} onChange={e => setForm({ ...form, model: e.target.value })}
               placeholder="e.g. WS-C2960X-48FPD-L or C9300-48P" list="family-models" />
        <div className="mt-1 text-xs text-gray-500">
          Supported families: {Object.values(families).map((f: any) => f.label).join(', ')}
        </div>
      </Field>
      <Field label="Site">
        <select className={inputCls} value={form.siteId} onChange={e => setForm({ ...form, siteId: e.target.value })}>
          <option value="">—</option>
          {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Field>
      <Field label="Location">
        <input className={inputCls} value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="IDF-2, rack 4" />
      </Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={busy || !form.mgmtIp || !form.credentialId}>
          {busy ? 'Onboarding… (detecting model)' : 'Add switch'}
        </Button>
      </div>
    </Modal>
  );
}

function CredentialManager({ credentials, onClose }: { credentials: any[]; onClose: () => void }) {
  const [form, setForm] = useState<any>({ name: '', sshUsername: '', sshPassword: '', enablePassword: '', snmpVersion: '2c', snmpCommunity: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setBusy(true); setError('');
    try {
      await api('/api/credentials', { method: 'POST', body: form });
      onClose();
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <Modal title="Credential profiles" onClose={onClose}>
      {credentials.length > 0 && (
        <ul className="mb-4 divide-y rounded border">
          {credentials.map(c => (
            <li key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span><b>{c.name}</b> — ssh: {c.ssh_username || '—'}, snmp v{c.snmp_version}</span>
              <button className="text-xs text-red-600 hover:underline"
                      onClick={() => api(`/api/credentials/${c.id}`, { method: 'DELETE' }).then(onClose)}>delete</button>
            </li>
          ))}
        </ul>
      )}
      <h3 className="mb-2 text-sm font-semibold">New profile</h3>
      {error && <div className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <Field label="Profile name"><input className={inputCls} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="SSH username"><input className={inputCls} value={form.sshUsername} onChange={e => setForm({ ...form, sshUsername: e.target.value })} /></Field>
        <Field label="SSH password"><input type="password" className={inputCls} value={form.sshPassword} onChange={e => setForm({ ...form, sshPassword: e.target.value })} /></Field>
        <Field label="Enable password (optional)"><input type="password" className={inputCls} value={form.enablePassword} onChange={e => setForm({ ...form, enablePassword: e.target.value })} /></Field>
        <Field label="SNMP community (v2c)"><input type="password" className={inputCls} value={form.snmpCommunity} onChange={e => setForm({ ...form, snmpCommunity: e.target.value })} /></Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Close</Button>
        <Button onClick={submit} disabled={busy || !form.name}>Save profile</Button>
      </div>
    </Modal>
  );
}
