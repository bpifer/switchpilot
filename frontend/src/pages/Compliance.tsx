import { useEffect, useState } from 'react';
import { useApiQuery } from '../hooks/useApiQuery';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAction } from '../hooks/useAction';
import type { Me } from '../App';
import { PageHeader, Card, Button, Modal, Field, inputCls } from '../components/ui';
import { useSiteScope, scoped } from '../context/SiteContext';
import ConfigPreviewModal from '../components/ConfigPreviewModal';

interface RuleRollup {
  id: string;
  name: string;
  severity: 'info' | 'warning' | 'critical';
  match_type: string;
  pattern: string;
  passed: number;
  total: number;
}
interface DeviceRollup {
  id: string;
  hostname: string;
  mgmt_ip: string;
  site_name: string | null;
  passed: number;
  total: number;
  critical_fails: number;
}
interface Summary {
  score: number | null;
  passed: number;
  total: number;
  rules: RuleRollup[];
  devices: DeviceRollup[];
}

const SEV_COLOR: Record<string, string> = {
  info:     'bg-blue-100 text-blue-700',
  warning:  'bg-amber-100 text-amber-700',
  critical: 'bg-red-100 text-red-700',
};

function scoreColor(pct: number): string {
  if (pct >= 95) return 'text-green-600';
  if (pct >= 80) return 'text-amber-600';
  return 'text-red-600';
}

export default function Compliance({ me }: { me: Me }) {
  const [showRules, setShowRules] = useState(false);
  const canEdit = me.role === 'superadmin' || me.role === 'netadmin';
  const { run, busy: evaluating } = useAction();

  const { data: summary = null, isLoading: loading, refetch: load } =
    useApiQuery<Summary>(scoped('/api/compliance/summary', useSiteScope().siteId), { refetchInterval: 60000 });

  const evaluate = () => run(async () => {
    await api('/api/compliance/evaluate', { method: 'POST' });
    load();
  });

  const pct = (p: number, t: number) => t ? Math.round(p / t * 100) : 0;

  return (
    <div>
      <PageHeader title="Configuration Compliance">
        {canEdit && <Button variant="secondary" onClick={() => setShowRules(true)}>Manage rules</Button>}
        <Button onClick={evaluate} disabled={evaluating}>{evaluating ? 'Evaluating…' : 'Run evaluation'}</Button>
      </PageHeader>

      <div className="px-6 py-4 space-y-4">
        {loading ? (
          <p className="py-8 text-center text-sm text-slate-400">Loading compliance data…</p>
        ) : !summary || summary.total === 0 ? (
          <Card>
            <p className="py-8 text-center text-sm text-slate-400">
              No compliance results yet. Make sure devices have at least one config backup, then press
              <strong> Run evaluation</strong>.
            </p>
          </Card>
        ) : (
          <>
            {/* Fleet score */}
            <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
              <Card>
                <div className="flex flex-col items-center py-3">
                  <div className={`text-5xl font-bold ${scoreColor(summary.score ?? 0)}`}>{summary.score}%</div>
                  <div className="mt-1 text-xs uppercase tracking-wide text-slate-400">Fleet compliance</div>
                  <div className="mt-2 text-sm text-slate-500">{summary.passed} / {summary.total} checks passing</div>
                </div>
              </Card>
              <Card title="Rules">
                <div className="space-y-2">
                  {summary.rules.map(r => {
                    const p = pct(r.passed, r.total);
                    return (
                      <div key={r.id} className="flex items-center gap-3">
                        <span className={`w-20 shrink-0 rounded-full px-2 py-0.5 text-center text-[11px] font-semibold ${SEV_COLOR[r.severity]}`}>
                          {r.severity}
                        </span>
                        <span className="w-56 shrink-0 truncate text-sm text-slate-700" title={r.pattern}>{r.name}</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <div className={`h-full ${p >= 95 ? 'bg-green-500' : p >= 80 ? 'bg-amber-500' : 'bg-red-500'}`}
                               style={{ width: `${p}%` }} />
                        </div>
                        <span className="w-16 shrink-0 text-right text-xs text-slate-500">{r.passed}/{r.total}</span>
                      </div>
                    );
                  })}
                  {summary.rules.length === 0 && <p className="text-sm text-slate-400">No enabled rules.</p>}
                </div>
              </Card>
            </div>

            {/* Per-device */}
            <Card title="Devices">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-slate-500">
                      <th className="py-2 pr-4">Device</th><th className="pr-4">Site</th>
                      <th className="pr-4">Score</th><th className="pr-4">Critical fails</th><th></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {summary.devices.map(d => {
                      const p = pct(d.passed, d.total);
                      return (
                        <tr key={d.id} className="hover:bg-slate-50/80">
                          <td className="py-2.5 pr-4">
                            <Link to={`/devices/${d.id}`} className="font-medium text-brand-600 hover:underline">
                              {d.hostname || d.mgmt_ip}
                            </Link>
                          </td>
                          <td className="pr-4 text-xs text-slate-500">{d.site_name ?? '—'}</td>
                          <td className="pr-4">
                            <span className={`font-semibold ${scoreColor(p)}`}>{p}%</span>
                            <span className="ml-1 text-xs text-slate-400">({d.passed}/{d.total})</span>
                          </td>
                          <td className="pr-4">
                            {d.critical_fails > 0
                              ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">{d.critical_fails}</span>
                              : <span className="text-xs text-slate-400">0</span>}
                          </td>
                          <td className="text-right">
                            <DeviceDetailLink deviceId={d.id} canEdit={canEdit} onChanged={load} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>

      {showRules && <RulesManager onClose={() => { setShowRules(false); load(); }} />}
    </div>
  );
}

function DeviceDetailLink({ deviceId, canEdit, onChanged }: { deviceId: string; canEdit: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="text-xs text-brand-600 hover:underline" onClick={() => setOpen(true)}>view checks</button>
      {open && <DeviceChecks deviceId={deviceId} canEdit={canEdit} onClose={() => setOpen(false)} onChanged={onChanged} />}
    </>
  );
}

interface DeviceCheck {
  rule_id: string;
  name: string;
  description: string;
  severity: 'info' | 'warning' | 'critical';
  remediation: string;
  benchmark: string;
  passed: boolean | null;
  detail: string | null;
  checked_at: string | null;
}

function DeviceChecks({ deviceId, canEdit, onClose, onChanged }: {
  deviceId: string; canEdit: boolean; onClose: () => void; onChanged: () => void;
}) {
  const [checks, setChecks] = useState<DeviceCheck[]>([]);
  const [preview, setPreview] = useState<{ rule: DeviceCheck; lines: any[]; summary: any; warnings: string[] } | null>(null);
  const [secretPw, setSecretPw] = useState('');
  const [enableModal, setEnableModal] = useState(false);
  const [cisOnly, setCisOnly] = useState(false);
  const { run, busy, isBusy } = useAction();

  const load = () => api<DeviceCheck[]>(`/api/compliance/device/${deviceId}`).then(setChecks).catch(() => setChecks([]));
  useEffect(() => { load(); }, []);

  const remediate = (ruleId: string) => run(async () => {
    await api('/api/compliance/remediate', { method: 'POST', body: { deviceId, ruleId } });
    await load(); onChanged(); setPreview(null);
  }, { key: ruleId });

  // Special remediation: push an enable secret (generated or operator-supplied),
  // store it on the device credential, and reveal a generated value once.
  const setEnableSecret = (password?: string) => run(async () => {
    const r = await api(`/api/devices/${deviceId}/remediate/enable-secret`, {
      method: 'POST', body: password ? { password } : {}
    });
    if (r.password) setSecretPw(r.password);   // only returned when generated
    setEnableModal(false);
    await load(); onChanged();
  }, { key: 'enable-secret' });

  // Dry run: show what the remediation would change before touching the device.
  // Server-side so template substitutions ({platform_host}) match what a real
  // remediation would actually push.
  const previewRemediation = (c: DeviceCheck) => run(async () => {
    const r = await api('/api/compliance/remediate', {
      method: 'POST', body: { deviceId, ruleId: c.rule_id, dryRun: true }
    });
    setPreview({ rule: c, lines: r.lines, summary: r.summary, warnings: r.warnings ?? [] });
  }, { key: c.rule_id });

  // Pull the running config and re-evaluate against it, so the results reflect
  // the device as it is now (including manual changes made outside SwitchPilot).
  const checkNow = () => run(async () => {
    await api(`/api/compliance/evaluate?deviceId=${deviceId}&fresh=true`, { method: 'POST' });
    await load(); onChanged();
  }, { key: 'check-now' });
  const checking = isBusy('check-now');

  const hasCis = checks.some(c => c.benchmark === 'CIS');
  const shown = cisOnly ? checks.filter(c => c.benchmark === 'CIS') : checks;
  const passedCount = shown.filter(c => c.passed === true).length;

  return (
    <Modal title="Compliance checks" onClose={onClose}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          Checks run against the most recent config backup ({passedCount}/{shown.length} passed).
          "Check now" pulls the running config first.
        </p>
        <div className="flex items-center gap-3">
          {hasCis && (
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={cisOnly} onChange={e => setCisOnly(e.target.checked)} />
              CIS only
            </label>
          )}
          <Button variant="secondary" onClick={checkNow} disabled={checking}>
            {checking ? 'Checking…' : 'Check now'}
          </Button>
        </div>
      </div>

      {secretPw && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="text-sm font-medium text-amber-800">Enable secret set (shown once)</div>
          <div className="mt-1 text-xs text-amber-700">Saved to this switch's credential profile. Keep a copy as backup.</div>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 rounded bg-white px-3 py-2 font-mono text-sm ring-1 ring-amber-200">{secretPw}</code>
            <Button variant="secondary" onClick={() => navigator.clipboard.writeText(secretPw)}>Copy</Button>
            <Button variant="secondary" onClick={() => setSecretPw('')}>Dismiss</Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {shown.map(c => (
          <div key={c.rule_id} className={`rounded-lg border p-2.5 ${
            c.passed === false ? 'border-red-200 bg-red-50/50' : c.passed ? 'border-green-200 bg-green-50/30' : 'border-slate-200'}`}>
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${SEV_COLOR[c.severity]}`}>{c.severity}</span>
              {c.benchmark && (
                <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 ring-1 ring-indigo-200">{c.benchmark}</span>
              )}
              <span className="text-sm font-medium text-slate-800">{c.name}</span>
              <span className="ml-auto">
                {c.passed === null ? (
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-500"
                        title='No result yet - use "Check now"'>not checked</span>
                ) : c.passed ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-[11px] font-semibold text-green-700">
                    ✓ Passed
                  </span>
                ) : (
                  <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-[11px] font-semibold text-red-700">Failed</span>
                )}
              </span>
            </div>
            {c.description && <p className="mt-1 text-xs text-slate-500">{c.description}</p>}
            {c.detail && c.passed === false && (
              <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-red-600">{c.detail}</pre>
            )}
            {c.passed && c.detail && <p className="mt-1 truncate font-mono text-xs text-green-700/70">{c.detail}</p>}
            {canEdit && c.passed === false && c.remediation && (
              <div className="mt-2 flex items-center justify-end gap-2">
                <Button variant="secondary" onClick={() => previewRemediation(c)} disabled={busy}>
                  {isBusy(c.rule_id) ? '…' : 'Preview'}
                </Button>
                <Button variant="secondary" onClick={() => remediate(c.rule_id)} disabled={busy}>
                  {isBusy(c.rule_id) ? 'Remediating…' : 'Remediate'}
                </Button>
              </div>
            )}
            {canEdit && c.passed === false && /enable secret/i.test(c.name) && (
              <div className="mt-2 flex justify-end">
                <Button variant="secondary" onClick={() => setEnableModal(true)} disabled={busy}>
                  {isBusy('enable-secret') ? 'Setting…' : 'Set enable secret'}
                </Button>
              </div>
            )}
          </div>
        ))}
        {checks.length === 0 && <p className="py-4 text-center text-sm text-slate-400">No checks for this device.</p>}
      </div>

      {enableModal && (
        <EnableSecretModal
          busy={isBusy('enable-secret')}
          onClose={() => setEnableModal(false)}
          onSubmit={pw => setEnableSecret(pw)}
        />
      )}

      {preview && (
        <ConfigPreviewModal
          title={`Preview: ${preview.rule.name}`}
          data={{ lines: preview.lines, warnings: preview.warnings, summary: preview.summary }}
          busy={isBusy(preview.rule.rule_id)}
          applyLabel="Apply remediation"
          onApply={() => remediate(preview.rule.rule_id)}
          onClose={() => setPreview(null)}
        />
      )}
    </Modal>
  );
}

function EnableSecretModal({ busy, onClose, onSubmit }: {
  busy: boolean; onClose: () => void; onSubmit: (pw?: string) => void;
}) {
  const [mode, setMode] = useState<'generate' | 'custom'>('generate');
  const [pw, setPw] = useState('');
  // Mirror the backend charset rule so the operator gets immediate feedback
  const valid = /^[\w.@!%*+=:-]{4,64}$/.test(pw);

  return (
    <Modal title="Set enable secret" onClose={onClose}>
      <p className="mb-3 text-sm text-slate-500">
        Pushes <span className="font-mono text-xs">enable secret …</span> to the switch and saves it to this
        device's credential profile so SwitchPilot can still enter privileged mode.
      </p>
      <label className="mb-2 flex items-center gap-2 text-sm">
        <input type="radio" checked={mode === 'generate'} onChange={() => setMode('generate')} />
        Generate a strong secret (shown once)
      </label>
      <label className="mb-2 flex items-center gap-2 text-sm">
        <input type="radio" checked={mode === 'custom'} onChange={() => setMode('custom')} />
        Set my own
      </label>
      {mode === 'custom' && (
        <div className="mb-2">
          <input className={inputCls} type="text" value={pw} onChange={e => setPw(e.target.value)}
                 placeholder="enable secret" autoFocus />
          {pw && !valid && (
            <p className="mt-1 text-xs text-red-600">4-64 chars: letters, digits, and . @ ! % * + = : - _</p>
          )}
        </div>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button
          onClick={() => onSubmit(mode === 'custom' ? pw : undefined)}
          disabled={busy || (mode === 'custom' && !valid)}
        >
          {busy ? 'Setting…' : 'Apply'}
        </Button>
      </div>
    </Modal>
  );
}

interface Rule {
  id: string;
  name: string;
  description: string;
  severity: 'info' | 'warning' | 'critical';
  match_type: string;
  pattern: string;
  remediation: string;
  site_id: string | null;
  site_name: string | null;
  enabled: boolean;
  auto_remediate: boolean;
}

const MATCH_LABELS: Record<string, string> = {
  line_present:  'Line present',
  line_absent:   'Line absent',
  regex_present: 'Regex matches',
  regex_absent:  'Regex absent',
};

function RulesManager({ onClose }: { onClose: () => void }) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [sites, setSites] = useState<{ id: string; name: string }[]>([]);
  const [editing, setEditing] = useState<Partial<Rule> | null>(null);
  const { run, busy } = useAction();

  const load = () => api<Rule[]>('/api/compliance/rules').then(setRules).catch(() => setRules([]));
  useEffect(() => {
    load();
    api<{ id: string; name: string }[]>('/api/sites').then(setSites).catch(() => setSites([]));
  }, []);

  const save = () => {
    if (!editing?.name?.trim() || !editing?.pattern?.trim()) return;
    const body = {
      name: editing.name, description: editing.description ?? '',
      severity: editing.severity ?? 'warning', match_type: editing.match_type ?? 'line_present',
      pattern: editing.pattern, remediation: editing.remediation ?? '',
      siteId: editing.site_id || null, enabled: editing.enabled ?? true,
      autoRemediate: editing.auto_remediate ?? false
    };
    run(async () => {
      if (editing.id) await api(`/api/compliance/rules/${editing.id}`, { method: 'PUT', body });
      else await api('/api/compliance/rules', { method: 'POST', body });
      setEditing(null); load();
    });
  };

  const remove = (id: string) => {
    if (!confirm('Delete this rule and its results?')) return;
    run(async () => { await api(`/api/compliance/rules/${id}`, { method: 'DELETE' }); load(); });
  };

  return (
    <Modal title="Compliance rules" onClose={onClose}>
      <div className="mb-3 flex justify-end">
        <Button onClick={() => setEditing({ severity: 'warning', match_type: 'line_present', enabled: true })}>Add rule</Button>
      </div>

      <div className="max-h-[45vh] space-y-2 overflow-auto">
        {rules.map(r => (
          <div key={r.id} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 text-sm">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${SEV_COLOR[r.severity]}`}>{r.severity}</span>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-slate-800">
                {r.name} {!r.enabled && <span className="text-xs text-slate-400">(disabled)</span>}
                {r.auto_remediate && <span className="ml-1 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700 ring-1 ring-brand-200">auto-fix</span>}
              </div>
              <div className="truncate font-mono text-xs text-slate-500">{MATCH_LABELS[r.match_type]}: {r.pattern}</div>
            </div>
            <button className="text-xs text-brand-600 hover:underline" onClick={() => setEditing(r)}>edit</button>
            <button className="text-xs text-red-600 hover:underline" onClick={() => remove(r.id)}>delete</button>
          </div>
        ))}
        {rules.length === 0 && <p className="py-4 text-center text-sm text-slate-400">No rules yet.</p>}
      </div>

      {editing && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">{editing.id ? 'Edit rule' : 'New rule'}</h3>
          <Field label="Name">
            <input className={inputCls} value={editing.name ?? ''} onChange={e => setEditing(p => ({ ...p, name: e.target.value }))} placeholder="e.g. NTP configured" />
          </Field>
          <Field label="Description">
            <input className={inputCls} value={editing.description ?? ''} onChange={e => setEditing(p => ({ ...p, description: e.target.value }))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Severity">
              <select className={inputCls} value={editing.severity} onChange={e => setEditing(p => ({ ...p, severity: e.target.value as any }))}>
                <option value="info">info</option><option value="warning">warning</option><option value="critical">critical</option>
              </select>
            </Field>
            <Field label="Match type">
              <select className={inputCls} value={editing.match_type} onChange={e => setEditing(p => ({ ...p, match_type: e.target.value }))}>
                {Object.entries(MATCH_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Pattern (substring for line_*, regex for regex_*)">
            <input className={`${inputCls} font-mono`} value={editing.pattern ?? ''} onChange={e => setEditing(p => ({ ...p, pattern: e.target.value }))} placeholder="e.g. ^ntp server " />
          </Field>
          <Field label="Remediation config lines (optional, one per line)">
            <textarea className={`${inputCls} font-mono h-20`} value={editing.remediation ?? ''} onChange={e => setEditing(p => ({ ...p, remediation: e.target.value }))} placeholder={'ntp server 10.0.0.1'} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Scope">
              <select className={inputCls} value={editing.site_id ?? ''} onChange={e => setEditing(p => ({ ...p, site_id: e.target.value || null }))}>
                <option value="">All sites</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Enabled">
              <select className={inputCls} value={editing.enabled ? '1' : '0'} onChange={e => setEditing(p => ({ ...p, enabled: e.target.value === '1' }))}>
                <option value="1">Enabled</option><option value="0">Disabled</option>
              </select>
            </Field>
          </div>
          {editing.remediation?.trim() && (
            <label className="mt-2 flex items-start gap-2 text-sm text-slate-600">
              <input type="checkbox" className="mt-0.5" checked={editing.auto_remediate ?? false}
                     onChange={e => setEditing(p => ({ ...p, auto_remediate: e.target.checked }))} />
              <span>
                Auto-remediate on the compliance sweep when a device fails this rule.
                <span className="block text-xs text-slate-400">
                  Also requires <span className="font-mono">COMPLIANCE_AUTO_REMEDIATE=true</span> on the server; never runs during a maintenance window.
                </span>
              </span>
            </label>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={busy || !editing.name?.trim() || !editing.pattern?.trim()}>{busy ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
