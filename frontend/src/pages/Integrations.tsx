import { useState } from 'react';
import { api } from '../api';
import { useApiQuery } from '../hooks/useApiQuery';
import { PageHeader, Card, Button, Modal, Field, inputCls } from '../components/ui';

export default function Integrations() {
  return (
    <div>
      <PageHeader title="Integrations" />
      <div className="space-y-4 p-6">
        <Webhooks />
        <ApiKeys />
      </div>
    </div>
  );
}

function Webhooks() {
  const { data: hooks = [], refetch } = useApiQuery<any[]>('/api/webhooks');
  const [editing, setEditing] = useState<any | null>(null);
  const [testing, setTesting] = useState('');

  async function test(id: string) {
    setTesting(id);
    try {
      const r = await api(`/api/webhooks/${id}/test`, { method: 'POST' });
      alert(`Delivery result: ${r.lastStatus}`);
      refetch();
    } catch (err: any) { alert(err.message); }
    finally { setTesting(''); }
  }

  async function remove(id: string) {
    if (!confirm('Delete this webhook?')) return;
    await api(`/api/webhooks/${id}`, { method: 'DELETE' }); refetch();
  }

  return (
    <Card title="Alert webhooks">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-slate-500">
          POST signed alert payloads to Slack, Teams, PagerDuty, Opsgenie, or any custom URL.
        </p>
        <Button onClick={() => setEditing({ name: '', url: '', secret: '', minSeverity: 'warning' })}>Add webhook</Button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase text-slate-500">
            <th className="py-1.5 pr-3">Name</th><th className="pr-3">URL</th><th className="pr-3">Min severity</th>
            <th className="pr-3">Signed</th><th className="pr-3">Last delivery</th><th></th>
          </tr>
        </thead>
        <tbody>
          {hooks.map(h => (
            <tr key={h.id} className="border-b last:border-0">
              <td className="py-2 pr-3 font-medium text-slate-700">{h.name}{!h.enabled && <span className="ml-1 text-xs text-slate-400">(disabled)</span>}</td>
              <td className="max-w-48 truncate pr-3 font-mono text-xs text-slate-500" title={h.url}>{h.url}</td>
              <td className="pr-3 text-xs">{h.min_severity}</td>
              <td className="pr-3 text-xs">{h.signed ? 'yes' : 'no'}</td>
              <td className="pr-3 text-xs text-slate-500">
                {h.last_fired_at ? `${new Date(h.last_fired_at).toLocaleString()} · ${h.last_status}` : 'never'}
              </td>
              <td className="space-x-2 text-right">
                <button className="text-xs text-brand-600 hover:underline" onClick={() => test(h.id)} disabled={testing === h.id}>
                  {testing === h.id ? 'testing…' : 'test'}
                </button>
                <button className="text-xs text-slate-500 hover:underline" onClick={() => setEditing({ ...h, minSeverity: h.min_severity })}>edit</button>
                <button className="text-xs text-red-600 hover:underline" onClick={() => remove(h.id)}>delete</button>
              </td>
            </tr>
          ))}
          {hooks.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-slate-400">No webhooks configured</td></tr>}
        </tbody>
      </table>
      {editing && <WebhookModal hook={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refetch(); }} />}
    </Card>
  );
}

function WebhookModal({ hook, onClose, onSaved }: { hook: any; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: hook.name, url: hook.url, secret: '', minSeverity: hook.minSeverity ?? 'warning' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setBusy(true); setError('');
    try {
      if (hook.id) await api(`/api/webhooks/${hook.id}`, { method: 'PUT', body: form });
      else await api('/api/webhooks', { method: 'POST', body: form });
      onSaved();
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={hook.id ? 'Edit webhook' : 'Add webhook'} onClose={onClose}>
      <Field label="Name"><input className={inputCls} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Slack #netops" autoFocus /></Field>
      <Field label="URL"><input className={inputCls} value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://hooks.slack.com/services/…" /></Field>
      <Field label="Signing secret (optional - adds X-SwitchPilot-Signature HMAC)">
        <input className={inputCls} value={form.secret} onChange={e => setForm({ ...form, secret: e.target.value })} placeholder={hook.id ? 'leave blank to keep current' : ''} />
      </Field>
      <Field label="Minimum severity">
        <select className={inputCls} value={form.minSeverity} onChange={e => setForm({ ...form, minSeverity: e.target.value })}>
          <option value="info">Info and above</option>
          <option value="warning">Warning and above</option>
          <option value="critical">Critical only</option>
        </select>
      </Field>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={busy || !form.name.trim() || !form.url.trim()}>{busy ? 'Saving…' : 'Save'}</Button>
      </div>
    </Modal>
  );
}

function ApiKeys() {
  const { data: keys = [], refetch } = useApiQuery<any[]>('/api/keys');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', role: 'readonly' });
  const [newToken, setNewToken] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const r = await api<{ token: string }>('/api/keys', { method: 'POST', body: form });
      setNewToken(r.token);
      setCreating(false); setForm({ name: '', role: 'readonly' });
      refetch();
    } catch (err: any) { alert(err.message); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!confirm('Revoke this API key? Scripts using it will stop working immediately.')) return;
    await api(`/api/keys/${id}`, { method: 'DELETE' }); refetch();
  }

  return (
    <Card title="API keys">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Non-expiring <span className="font-mono text-xs">sp_…</span> tokens for scripts and integrations.
          Send as <span className="font-mono text-xs">Authorization: Bearer sp_…</span>.
        </p>
        <Button onClick={() => setCreating(true)}>Create key</Button>
      </div>

      {newToken && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="text-sm font-medium text-amber-800">New API key (shown once)</div>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-white px-3 py-2 font-mono text-xs ring-1 ring-amber-200">{newToken}</code>
            <Button variant="secondary" onClick={() => navigator.clipboard.writeText(newToken)}>Copy</Button>
          </div>
          <button className="mt-2 text-xs text-amber-700 hover:underline" onClick={() => setNewToken('')}>Dismiss</button>
        </div>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase text-slate-500">
            <th className="py-1.5 pr-3">Name</th><th className="pr-3">Role</th><th className="pr-3">Created by</th>
            <th className="pr-3">Last used</th><th></th>
          </tr>
        </thead>
        <tbody>
          {keys.map(k => (
            <tr key={k.id} className="border-b last:border-0">
              <td className="py-2 pr-3 font-medium text-slate-700">{k.name}</td>
              <td className="pr-3 text-xs capitalize">{k.role}</td>
              <td className="pr-3 text-xs text-slate-500">{k.created_by}</td>
              <td className="pr-3 text-xs text-slate-500">{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'never'}</td>
              <td className="text-right"><button className="text-xs text-red-600 hover:underline" onClick={() => remove(k.id)}>revoke</button></td>
            </tr>
          ))}
          {keys.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-slate-400">No API keys</td></tr>}
        </tbody>
      </table>

      {creating && (
        <Modal title="Create API key" onClose={() => setCreating(false)}>
          <Field label="Name"><input className={inputCls} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="grafana-datasource" autoFocus /></Field>
          <Field label="Role">
            <select className={inputCls} value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
              <option value="readonly">Read only</option>
              <option value="helpdesk">Help desk</option>
              <option value="netadmin">Network admin</option>
              <option value="superadmin">Super admin</option>
            </select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
            <Button onClick={create} disabled={busy || !form.name.trim()}>{busy ? 'Creating…' : 'Create'}</Button>
          </div>
        </Modal>
      )}
    </Card>
  );
}
