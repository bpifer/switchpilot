import { useState } from 'react';
import { api } from '../api';
import { useAction } from '../hooks/useAction';
import { useApiQuery } from '../hooks/useApiQuery';
import type { Me } from '../App';
import { PageHeader, Card, Button, Modal, Field, inputCls } from '../components/ui';

export default function Templates({ me }: { me: Me }) {
  const [editing, setEditing] = useState<any | null>(null);
  const [deploying, setDeploying] = useState<any | null>(null);
  const canEdit = me.role === 'superadmin' || me.role === 'netadmin';
  const { run, isBusy } = useAction();

  const { data: templates = [], refetch: load } = useApiQuery<any[]>('/api/templates');
  const { data: devices = [] } = useApiQuery<any[]>('/api/devices');

  const remove = (t: any) => {
    if (!confirm(`Delete template "${t.name}"?`)) return;
    run(async () => { await api(`/api/templates/${t.id}`, { method: 'DELETE' }); load(); }, { key: t.id });
  };

  return (
    <div>
      <PageHeader title="Configuration templates">
        {canEdit && <Button onClick={() => setEditing({ name: '', category: 'general', description: '', body: '', variables: [] })}>+ New template</Button>}
      </PageHeader>
      <div className="grid gap-4 p-6 md:grid-cols-2 lg:grid-cols-3">
        {templates.map(t => (
          <Card key={t.id} title={t.name}>
            <div className="mb-1 text-xs uppercase text-gray-400">{t.category}</div>
            <p className="mb-2 text-sm text-gray-600">{t.description || 'No description'}</p>
            <pre className="mb-3 max-h-32 overflow-auto rounded bg-gray-900 p-2 text-xs text-gray-100">{t.body}</pre>
            <div className="flex gap-2">
              {canEdit && <Button onClick={() => setDeploying(t)}>Deploy</Button>}
              {canEdit && <Button variant="secondary" onClick={() => setEditing(t)}>Edit</Button>}
              {canEdit && <Button variant="danger" disabled={isBusy(t.id)} onClick={() => remove(t)}>
                {isBusy(t.id) ? 'Deleting…' : 'Delete'}
              </Button>}
            </div>
          </Card>
        ))}
        {templates.length === 0 && <div className="text-gray-400">No templates yet. Templates are reusable IOS snippets with {'{{variable}}'} placeholders.</div>}
      </div>

      {editing && <TemplateEditor template={editing} onClose={() => { setEditing(null); load(); }} />}
      {deploying && <DeployModal template={deploying} devices={devices} onClose={() => setDeploying(null)} />}
    </div>
  );
}

function TemplateEditor({ template, onClose }: { template: any; onClose: () => void }) {
  const [form, setForm] = useState({ ...template, variables: JSON.stringify(template.variables ?? [], null, 0) });
  const [error, setError] = useState('');

  async function save() {
    setError('');
    try {
      const variables = JSON.parse(form.variables || '[]');
      if (template.id) {
        await api(`/api/templates/${template.id}`, { method: 'PATCH', body: { body: form.body, description: form.description, variables } });
      } else {
        await api('/api/templates', { method: 'POST', body: { name: form.name, category: form.category, description: form.description, body: form.body, variables } });
      }
      onClose();
    } catch (err: any) { setError(err.message); }
  }

  return (
    <Modal title={template.id ? `Edit ${template.name}` : 'New template'} onClose={onClose}>
      {error && <div className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {!template.id && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name"><input className={inputCls} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Category">
            <select className={inputCls} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
              {['general', 'vlan', 'interface', 'qos', 'acl', 'stp', 'snmp', 'ntp', 'aaa', 'security'].map(c => <option key={c}>{c}</option>)}
            </select>
          </Field>
        </div>
      )}
      <Field label="Description"><input className={inputCls} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></Field>
      <Field label="IOS commands ({{var}} placeholders supported)">
        <textarea className="h-48 w-full rounded border p-2 font-mono text-xs" value={form.body}
                  placeholder={'vlan {{vlan_id}}\n name {{vlan_name}}'}
                  onChange={e => setForm({ ...form, body: e.target.value })} />
      </Field>
      <Field label='Variables (JSON, e.g. [{"name":"vlan_id"},{"name":"vlan_name","default":"USERS"}])'>
        <input className={`${inputCls} font-mono`} value={form.variables} onChange={e => setForm({ ...form, variables: e.target.value })} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={!form.name || !form.body}>Save</Button>
      </div>
    </Modal>
  );
}

function DeployModal({ template, devices, onClose }: { template: any; devices: any[]; onClose: () => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [vars, setVars] = useState<Record<string, string>>({});
  const [scheduleAt, setScheduleAt] = useState('');
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const varDefs: any[] = template.variables ?? [];

  async function deploy() {
    setError('');
    try {
      await api(`/api/templates/${template.id}/deploy`, {
        method: 'POST',
        body: { deviceIds: selected, variables: vars, ...(scheduleAt ? { scheduleAt: new Date(scheduleAt).toISOString() } : {}) }
      });
      setDone(true);
    } catch (err: any) { setError(err.message + (err.detail ? `: ${JSON.stringify(err.detail)}` : '')); }
  }

  if (done) {
    return (
      <Modal title="Deployment queued" onClose={onClose}>
        <p className="text-sm">Job created for {selected.length} device(s){scheduleAt ? `, scheduled for ${new Date(scheduleAt).toLocaleString()}` : ' and running now'}. Track it on the Jobs page.</p>
        <div className="mt-4 text-right"><Button onClick={onClose}>Close</Button></div>
      </Modal>
    );
  }

  return (
    <Modal title={`Deploy "${template.name}"`} onClose={onClose}>
      {error && <div className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <Field label={`Target devices (${selected.length} selected)`}>
        <div className="max-h-40 overflow-auto rounded border p-2">
          {devices.map(d => (
            <label key={d.id} className="flex items-center gap-2 py-0.5 text-sm">
              <input type="checkbox" checked={selected.includes(d.id)}
                     onChange={e => setSelected(e.target.checked ? [...selected, d.id] : selected.filter(x => x !== d.id))} />
              {d.hostname || d.mgmt_ip} <span className="text-xs text-gray-400">{d.model}</span>
            </label>
          ))}
        </div>
      </Field>
      {varDefs.map((v: any) => (
        <Field key={v.name} label={`Variable: ${v.name}${v.default ? ` (default ${v.default})` : ''}`}>
          <input className={inputCls} value={vars[v.name] ?? ''} onChange={e => setVars({ ...vars, [v.name]: e.target.value })} />
        </Field>
      ))}
      <Field label="Schedule (leave blank to run immediately)">
        <input type="datetime-local" className={inputCls} value={scheduleAt} onChange={e => setScheduleAt(e.target.value)} />
      </Field>
      <div className="flex justify-between">
        <Button variant="secondary" onClick={async () => {
          try { setPreview((await api(`/api/templates/${template.id}/render`, { method: 'POST', body: { variables: vars } })).lines.join('\n')); }
          catch (err: any) { setError(err.message); }
        }}>Preview</Button>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={deploy} disabled={selected.length === 0}>Deploy</Button>
        </div>
      </div>
      {preview && <pre className="mt-3 max-h-40 overflow-auto rounded bg-gray-900 p-2 text-xs text-gray-100">{preview}</pre>}
    </Modal>
  );
}
