import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useApiQuery } from '../hooks/useApiQuery';
import type { Me } from '../App';
import { PageHeader, Card, Button, StatusBadge, Modal, Field, inputCls } from '../components/ui';
import { useSiteScope, scoped } from '../context/SiteContext';

export default function Alerts({ me }: { me: Me }) {
  const [showAll, setShowAll] = useState(false);
  const [newRule, setNewRule] = useState(false);
  const [editRule, setEditRule] = useState<any | null>(null);
  const [ackTarget, setAckTarget] = useState<any | null>(null);
  const canAck = me.role !== 'readonly';
  const canRules = me.role === 'superadmin' || me.role === 'netadmin';

  const { siteId } = useSiteScope();
  const queryClient = useQueryClient();
  const { data: alerts = [], refetch: refetchAlerts } = useApiQuery<any[]>(scoped(`/api/alerts?open=${!showAll}`, siteId), { refetchInterval: 20000 });
  const { data: rules = [], refetch: refetchRules } = useApiQuery<any[]>('/api/automation/rules');
  // Ack/resolve changes the open-alert count that drives the global bell badge
  // (/api/summary, polled every 30s). Invalidate it too so the badge updates
  // immediately instead of lagging until its next poll.
  const load = () => {
    refetchAlerts();
    refetchRules();
    queryClient.invalidateQueries({ queryKey: ['/api/summary'] });
  };

  async function resolve(a: any) {
    if (!window.confirm(`Resolve this alert?\n\n${a.hostname ?? 'platform'}: ${a.message}`)) return;
    await api(`/api/alerts/${a.id}/resolve`, { method: 'POST' });
    load();
  }

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
              <li key={a.id} className="py-2 text-sm">
                <div className="flex items-center gap-3">
                  <StatusBadge status={a.severity} />
                  <span className="font-medium">{a.hostname ?? 'platform'}</span>
                  <span className="flex-1 text-gray-600">{a.message}</span>
                  <span className="text-xs text-gray-400">{new Date(a.created_at).toLocaleString()}</span>
                  {a.resolved_at ? <span className="text-xs text-green-600">resolved</span> : canAck && (
                    <span className="flex gap-2">
                      {!a.acknowledged && <button className="text-xs text-brand-600 hover:underline"
                        onClick={() => setAckTarget(a)}>ack</button>}
                      <button className="text-xs text-gray-500 hover:underline"
                        onClick={() => resolve(a)}>resolve</button>
                    </span>
                  )}
                </div>
                {a.acknowledged && (a.acknowledged_by || a.ack_note) && (
                  <div className="mt-1 pl-9 text-xs text-gray-400">
                    ack’d{a.acknowledged_by ? ` by ${a.acknowledged_by}` : ''}
                    {a.ack_note ? ` — “${a.ack_note}”` : ''}
                  </div>
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
                      <button className="text-xs text-brand-600 hover:underline"
                              onClick={() => setEditRule(r)}>edit</button>
                      <button className="text-xs text-red-600 hover:underline"
                              onClick={() => { if (window.confirm(`Delete automation rule “${r.name}”?`)) api(`/api/automation/rules/${r.id}`, { method: 'DELETE' }).then(load); }}>delete</button>
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
      {newRule && <RuleModal onClose={() => { setNewRule(false); load(); }} />}
      {editRule && <RuleModal rule={editRule} onClose={() => { setEditRule(null); load(); }} />}
      {ackTarget && <AckModal alert={ackTarget} onClose={() => { setAckTarget(null); load(); }} />}
    </div>
  );
}

function AckModal({ alert, onClose }: { alert: any; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setBusy(true); setError('');
    try {
      await api(`/api/alerts/${alert.id}/ack`, { method: 'POST', body: { note } });
      onClose();
    } catch (err: any) { setError(err.message); setBusy(false); }
  }

  return (
    <Modal title="Acknowledge alert" onClose={onClose}>
      <p className="mb-3 text-sm text-gray-600">
        <StatusBadge status={alert.severity} /> {alert.hostname ?? 'platform'}: {alert.message}
      </p>
      {error && <div className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <Field label="Note (optional)">
        <textarea className={inputCls} rows={3} value={note} onChange={e => setNote(e.target.value)}
                  placeholder="e.g. known issue, RMA pending; expected during migration" />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Acknowledge'}</Button>
      </div>
    </Modal>
  );
}

function RuleModal({ rule, onClose }: { rule?: any; onClose: () => void }) {
  const editing = !!rule;
  const [form, setForm] = useState({
    name: rule?.name ?? '',
    trigger: rule?.trigger ?? 'port_down',
    action: rule?.action ?? 'notify',
    threshold: rule?.condition?.threshold != null ? String(rule.condition.threshold) : '',
    message: rule?.action_params?.message ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setBusy(true); setError('');
    try {
      const body = {
        name: form.name,
        trigger: form.trigger,
        action: form.action,
        condition: form.threshold ? { threshold: parseFloat(form.threshold) } : {},
        actionParams: form.message ? { message: form.message } : {},
      };
      if (editing) await api(`/api/automation/rules/${rule.id}`, { method: 'PATCH', body });
      else await api('/api/automation/rules', { method: 'POST', body });
      onClose();
    } catch (err: any) { setError(err.message); setBusy(false); }
  }

  return (
    <Modal title={editing ? 'Edit automation rule' : 'New automation rule'} onClose={onClose}>
      {error && <div className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <Field label="Name"><input className={inputCls} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="Trigger">
        <select className={inputCls} value={form.trigger} onChange={e => setForm({ ...form, trigger: e.target.value })}>
          {['port_down', 'device_offline', 'cpu_high', 'config_drift', 'temp_high', 'psu_fail', 'fan_fail', 'port_flapping'].map(t => <option key={t}>{t}</option>)}
        </select>
      </Field>
      <Field label="Action">
        <select className={inputCls} value={form.action} onChange={e => setForm({ ...form, action: e.target.value })}>
          {['notify', 'restore_baseline', 'run_template', 'disable_port'].map(a => <option key={a}>{a}</option>)}
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
        <Button onClick={save} disabled={!form.name || busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create rule'}</Button>
      </div>
    </Modal>
  );
}
