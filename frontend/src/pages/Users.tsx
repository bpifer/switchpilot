import { useEffect, useState } from 'react';
import { api } from '../api';
import { PageHeader, Card, Button, Modal, Field, inputCls, StatusBadge } from '../components/ui';

export default function Users() {
  const [users, setUsers] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);

  const load = () => {
    api('/api/users').then(setUsers).catch(() => {});
    api('/api/audit?limit=50').then(setAudit).catch(() => {});
  };
  useEffect(load, []);

  return (
    <div>
      <PageHeader title="Users & audit">
        <Button onClick={() => setShowAdd(true)}>+ Add user</Button>
      </PageHeader>
      <div className="grid gap-4 p-6 lg:grid-cols-2">
        <Card title="Users">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs uppercase text-gray-500">
              <th className="py-1">User</th><th>Role</th><th>Source</th><th>MFA</th><th>Status</th><th>Last login</th><th></th></tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-b last:border-0">
                  <td className="py-1.5"><b>{u.username}</b><div className="text-xs text-gray-400">{u.display_name}</div></td>
                  <td className="capitalize">{u.role}</td>
                  <td>{u.auth_source}</td>
                  <td>{u.mfa_enabled ? '✓' : '—'}</td>
                  <td><StatusBadge status={u.enabled ? 'online' : 'disabled'} /></td>
                  <td className="text-xs">{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : 'never'}</td>
                  <td className="space-x-2 text-right">
                    <select className="rounded border px-1 py-0.5 text-xs" value={u.role}
                            onChange={e => api(`/api/users/${u.id}`, { method: 'PATCH', body: { role: e.target.value } }).then(load)}>
                      {['superadmin', 'netadmin', 'helpdesk', 'readonly'].map(r => <option key={r}>{r}</option>)}
                    </select>
                    <button className="text-xs text-gray-500 hover:underline"
                            onClick={() => api(`/api/users/${u.id}`, { method: 'PATCH', body: { enabled: !u.enabled } }).then(load)}>
                      {u.enabled ? 'disable' : 'enable'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Recent audit log">
          <ul className="max-h-[28rem] divide-y overflow-auto text-sm">
            {audit.map(a => (
              <li key={a.id} className="py-1.5">
                <span className="font-medium">{a.username}</span>{' '}
                <span className="text-gray-600">{a.action}</span>{' '}
                <span className="text-gray-400">{a.target}</span>
                <span className="float-right text-xs text-gray-400">{new Date(a.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      {showAdd && <AddUser onClose={() => { setShowAdd(false); load(); }} />}
    </div>
  );
}

function AddUser({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ username: '', displayName: '', email: '', role: 'readonly', password: '', authSource: 'local' });
  const [error, setError] = useState('');

  async function save() {
    setError('');
    try {
      await api('/api/users', { method: 'POST', body: form });
      onClose();
    } catch (err: any) { setError(err.message); }
  }

  return (
    <Modal title="Add user" onClose={onClose}>
      {error && <div className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Username"><input className={inputCls} value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} /></Field>
        <Field label="Display name"><input className={inputCls} value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} /></Field>
        <Field label="Email"><input className={inputCls} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Role">
          <select className={inputCls} value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
            {['superadmin', 'netadmin', 'helpdesk', 'readonly'].map(r => <option key={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="Auth source">
          <select className={inputCls} value={form.authSource} onChange={e => setForm({ ...form, authSource: e.target.value })}>
            <option value="local">local</option><option value="ldap">ldap / Active Directory</option>
          </select>
        </Field>
        {form.authSource === 'local' &&
          <Field label="Initial password (min 12 chars)"><input type="password" className={inputCls} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></Field>}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={!form.username || (form.authSource === 'local' && form.password.length < 12)}>Create</Button>
      </div>
    </Modal>
  );
}
