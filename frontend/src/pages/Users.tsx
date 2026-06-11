import { useEffect, useState } from 'react';
import { api } from '../api';
import { PageHeader, Card, Button, Modal, Field, inputCls, StatusBadge } from '../components/ui';

export default function Users() {
  const [users, setUsers] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showPolicy, setShowPolicy] = useState(false);

  const load = () => {
    api('/api/users').then(setUsers).catch(() => {});
    api('/api/audit?limit=50').then(setAudit).catch(() => {});
  };
  useEffect(load, []);

  const unlock = (id: string) => api(`/api/security/unlock/${id}`, { method: 'POST' }).then(load).catch(() => {});

  return (
    <div>
      <PageHeader title="Users & audit">
        <Button variant="secondary" onClick={() => setShowPolicy(true)}>Security policy</Button>
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
                  <td>
                    {u.locked
                      ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">locked</span>
                      : <StatusBadge status={u.enabled ? 'online' : 'disabled'} />}
                  </td>
                  <td className="text-xs">{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : 'never'}</td>
                  <td className="space-x-2 text-right">
                    {u.locked && (
                      <button className="text-xs font-medium text-amber-600 hover:underline" onClick={() => unlock(u.id)}>unlock</button>
                    )}
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
        <div className="space-y-4">
          <AuditIntegrity />
          <Card title="Recent audit log">
            <ul className="max-h-[24rem] divide-y overflow-auto text-sm">
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
      </div>
      {showAdd && <AddUser onClose={() => { setShowAdd(false); load(); }} />}
      {showPolicy && <SecurityPolicy onClose={() => setShowPolicy(false)} />}
    </div>
  );
}

function AuditIntegrity() {
  const [result, setResult] = useState<{ valid: boolean; checked: number; legacySkipped?: number; reason: string; brokenAtId: number | null } | null>(null);
  const [busy, setBusy] = useState(false);

  async function verify() {
    setBusy(true);
    try { setResult(await api('/api/security/audit/verify')); }
    catch (err: any) { setResult({ valid: false, checked: 0, reason: err.message, brokenAtId: null }); }
    finally { setBusy(false); }
  }

  return (
    <Card title="Audit log integrity">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Each entry is hash-chained to the previous one; verification detects any edit or deletion.</p>
        <Button variant="secondary" onClick={verify} disabled={busy}>{busy ? 'Verifying…' : 'Verify chain'}</Button>
      </div>
      {result && (
        <div className={`mt-3 rounded-lg px-3 py-2 text-sm ${result.valid ? 'bg-green-50 text-green-700 ring-1 ring-green-200' : 'bg-red-50 text-red-700 ring-1 ring-red-200'}`}>
          {result.valid
            ? <>✓ Intact — {result.checked} entries verified{result.legacySkipped ? `, ${result.legacySkipped} legacy entries skipped` : ''}.</>
            : <>✗ Tampering detected{result.brokenAtId ? ` at entry #${result.brokenAtId}` : ''}: {result.reason}</>}
        </div>
      )}
    </Card>
  );
}

const ROLES = ['superadmin', 'netadmin', 'helpdesk', 'readonly'] as const;

function SecurityPolicy({ onClose }: { onClose: () => void }) {
  const [p, setP] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { api('/api/security/policy').then(setP).catch(() => {}); }, []);
  if (!p) return <Modal title="Security policy" onClose={onClose}><p className="text-sm text-slate-400">Loading…</p></Modal>;

  const set = (k: string, v: any) => { setP({ ...p, [k]: v }); setSaved(false); };
  const toggleRole = (r: string) => {
    const roles: string[] = p.mfa_required_roles ?? [];
    set('mfa_required_roles', roles.includes(r) ? roles.filter(x => x !== r) : [...roles, r]);
  };

  async function save() {
    setBusy(true);
    try { await api('/api/security/policy', { method: 'PUT', body: p }); setSaved(true); }
    catch (err: any) { alert(err.message); }
    finally { setBusy(false); }
  }

  const num = (k: string, label: string, hint?: string) => (
    <Field label={label}>
      <input type="number" className={inputCls} value={p[k]} onChange={e => set(k, parseInt(e.target.value) || 0)} />
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
    </Field>
  );
  const chk = (k: string, label: string) => (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input type="checkbox" className="rounded border-slate-300" checked={!!p[k]} onChange={e => set(k, e.target.checked)} />
      {label}
    </label>
  );

  return (
    <Modal title="Security policy" onClose={onClose}>
      <h3 className="mb-2 text-sm font-semibold text-slate-700">Password requirements</h3>
      <div className="grid grid-cols-2 gap-3">
        {num('password_min_length', 'Minimum length')}
        {num('password_max_age_days', 'Max age (days)', '0 = never expires')}
      </div>
      <div className="mb-4 mt-2 grid grid-cols-2 gap-2">
        {chk('password_require_upper', 'Require uppercase')}
        {chk('password_require_lower', 'Require lowercase')}
        {chk('password_require_digit', 'Require digit')}
        {chk('password_require_symbol', 'Require symbol')}
      </div>

      <h3 className="mb-2 text-sm font-semibold text-slate-700">Account lockout</h3>
      <div className="mb-4 grid grid-cols-2 gap-3">
        {num('lockout_threshold', 'Failed attempts', '0 = disabled')}
        {num('lockout_minutes', 'Lock duration (min)')}
      </div>

      <h3 className="mb-2 text-sm font-semibold text-slate-700">Multi-factor authentication</h3>
      <label className="mb-2 flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" className="rounded border-slate-300" checked={!!p.mfa_required} onChange={e => set('mfa_required', e.target.checked)} />
        Require MFA enrollment
      </label>
      {p.mfa_required && (
        <div className="mb-4">
          <div className="mb-1 text-xs text-slate-500">Applies to roles (none selected = all roles):</div>
          <div className="flex flex-wrap gap-2">
            {ROLES.map(r => (
              <label key={r} className="flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 text-xs">
                <input type="checkbox" checked={(p.mfa_required_roles ?? []).includes(r)} onChange={() => toggleRole(r)} />
                {r}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        {saved && <span className="text-sm text-green-600">Saved</span>}
        <Button variant="secondary" onClick={onClose}>Close</Button>
        <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save policy'}</Button>
      </div>
    </Modal>
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
          <Field label="Initial password"><input type="password" className={inputCls} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="must meet the security policy" /></Field>}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={!form.username || (form.authSource === 'local' && !form.password)}>Create</Button>
      </div>
    </Modal>
  );
}
