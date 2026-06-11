import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Me } from '../App';
import { PageHeader, Card, Button, StatusBadge, Modal, Field, inputCls } from '../components/ui';

export default function Alerts({ me }: { me: Me }) {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [newRule, setNewRule] = useState(false);
  const canAck = me.role !== 'readonly';
  const canRules = me.role === 'superadmin' || me.role === 'netadmin';

  const load = () => {
    api(`/api/alerts?open=${!showAll}`).then(setAlerts).catch(() => {});
    api('/api/automation/rules').then(setRules).catch(() => {});
  };
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [showAll]);

  return (
    <div>
      <PageHeader title="Alerts & automation">
        <Button variant="secondary" onClick={() => setShowAll(!showAll)}>{showAll ? 'Open only' : 'Show history'}</Button>
        {canRules && <Button onClick={() => setNewRule(true)}>+ Automation rule</Button>}
      </PageHeader>
      <div className="grid gap-4 p-6 lg:grid-cols-[2fr_1fr]">
        <Card title="Alerts">
          <ul className="divide-y">
            {alerts.map(a => (
              <li key={a.id} className="flex items-center gap-3 py-2 text-sm">
                <StatusBadge status={a.severity} />
                <span className="font-medium">{a.hostname ?? 'platform'}</span>
                <span className="flex-1 text-gray-600">{a.message}</span>
                <span className="text-xs text-gray-400">{new Date(a.created_at).toLocaleString()}</span>
                {a.resolved_at ? <span className="text-xs text-green-600">resolved</span> : canAck && (
                  <span className="flex gap-2">
                    {!a.acknowledged && <button className="text-xs text-brand-600 hover:underline"
                      onClick={() => api(`/api/alerts/${a.id}/ack`, { method: 'POST' }).then(load)}>ack</button>}
                    <button className="text-xs text-gray-500 hover:underline"
                      onClick={() => api(`/api/alerts/${a.id}/resolve`, { method: 'POST' }).then(load)}>resolve</button>
                  </span>
                )}
              </li>
            ))}
            {alerts.length === 0 && <li className="py-6 text-center text-sm text-gray-400">No alerts</li>}
          </ul>
        </Card>
        <Card title="Automation rules">
          <ul className="divide-y">
            {rules.map(r => (
              <li key={r.id} className="py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{r.name}</span>
                  {canRules && (
                    <span className="flex items-center gap-2">
                      <label className="flex items-center gap-1 text-xs text-gray-500">
                        <input type="checkbox" checked={r.enabled}
                               onChange={e => api(`/api/automation/rules/${r.id}`, { method: 'PATCH', body: { enabled: e.target.checked } }).then(load)} />
                        enabled
                      </label>
                      <button className="text-xs text-red-600 hover:underline"
                              onClick={() => api(`/api/automation/rules/${r.id}`, { method: 'DELETE' }).then(load)}>delete</button>
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500">when <b>{r.trigger}</b> → <b>{r.action}</b></div>
              </li>
            ))}
            {rules.length === 0 && <li className="py-4 text-center text-sm text-gray-400">No rules. Example: “if a port goes down, notify Teams”.</li>}
          </ul>
        </Card>
      </div>
      {newRule && <NewRuleModal onClose={() => { setNewRule(false); load(); }} />}
    </div>
  );
}

function NewRuleModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ name: '', trigger: 'port_down', action: 'notify', threshold: '', message: '' });
  const [error, setError] = useState('');

  async function save() {
    setError('');
    try {
      await api('/api/automation/rules', {
        method: 'POST',
        body: {
          name: form.name,
          trigger: form.trigger,
          action: form.action,
          condition: form.threshold ? { threshold: parseFloat(form.threshold) } : {},
          actionParams: form.message ? { message: form.message } : {}
        }
      });
      onClose();
    } catch (err: any) { setError(err.message); }
  }

  return (
    <Modal title="New automation rule" onClose={onClose}>
      {error && <div className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <Field label="Name"><input className={inputCls} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="Trigger">
        <select className={inputCls} value={form.trigger} onChange={e => setForm({ ...form, trigger: e.target.value })}>
          {['port_down', 'device_offline', 'cpu_high', 'config_drift', 'temp_high', 'psu_fail', 'fan_fail', 'port_flapping'].map(t => <option key={t}>{t}</option>)}
        </select>
      </Field>
      <Field label="Action">
        <select className={inputCls} value={form.action} onChange={e => setForm({ ...form, action: e.target.value })}>
          {['notify', 'restore_baseline', 'disable_port'].map(a => <option key={a}>{a}</option>)}
        </select>
      </Field>
      <Field label="Threshold (optional, for cpu/temp triggers)">
        <input className={inputCls} value={form.threshold} onChange={e => setForm({ ...form, threshold: e.target.value })} placeholder="90" />
      </Field>
      <Field label="Custom message (optional, {{hostname}}/{{port}} placeholders)">
        <input className={inputCls} value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={!form.name}>Create rule</Button>
      </div>
    </Modal>
  );
}
