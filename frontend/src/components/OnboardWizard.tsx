// Guided switch onboarding: credentials -> config analysis -> onboard.
// Optionally creates a dedicated SPAdmin account on the switch so changes made
// by the platform are attributable in the switch's own logs and AAA records.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useSiteScope } from '../context/SiteContext';
import { Modal, Button, Field, inputCls } from './ui';

interface Analysis {
  identity: { hostname: string; model: string; serial: string; iosVersion: string };
  users: { name: string; priv15: boolean }[];
  checklist: { key: string; label: string; present: boolean; why: string }[];
  usingPlatformAccount: boolean;
  spAdminExists: boolean;
  otherAdmins: string[];
  vendor?: string;   // 'cisco' | 'mikrotik'
  hostKeyFingerprint?: string;
}

interface OnboardResult {
  device: any;
  account: string;
  generatedPassword: string | null;
  warnings: string[];
}

export default function OnboardWizard({ sites, onClose, initialIp = '' }: {
  sites: any[]; onClose: () => void;
  /** Prefill the management IP (e.g. one-click add from a discovery suggestion). */
  initialIp?: string;
}) {
  const [step, setStep] = useState<'creds' | 'review' | 'done'>('creds');
  const { siteId: scopeSite } = useSiteScope();
  const [form, setForm] = useState({
    mgmtIp: initialIp, username: '', password: '', enablePassword: '',
    // default the site to the currently selected scope (when it's a real site)
    siteId: scopeSite !== 'unassigned' ? scopeSite : '',
    location: ''
  });
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [createAccount, setCreateAccount] = useState(true);
  const [applyBaseline, setApplyBaseline] = useState(true);
  const [result, setResult] = useState<OnboardResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const isMikrotik = analysis?.vendor === 'mikrotik';
  const baselineComplete = !!analysis && analysis.checklist.every(c => c.present);
  // RouterOS has no SPAdmin/privilege-15 account concept; onboarding uses the
  // supplied admin account as-is, so the account requirement is N/A.
  const hasPlatformAccount = !!analysis && (isMikrotik || analysis.spAdminExists || analysis.usingPlatformAccount);
  const requirementsMet = baselineComplete && hasPlatformAccount;

  async function analyze() {
    setBusy(true); setError('');
    try {
      const a = await api<Analysis>('/api/onboarding/analyze', {
        method: 'POST',
        body: { mgmtIp: form.mgmtIp.trim(), username: form.username.trim(), password: form.password, enablePassword: form.enablePassword || undefined }
      });
      setAnalysis(a);
      // Don't offer to (re)create SPAdmin when it already exists - creating it
      // again would overwrite its password out from under whoever holds it.
      // RouterOS has no such account flow, so never offer it there.
      if (a.vendor === 'mikrotik' || a.usingPlatformAccount || a.spAdminExists) setCreateAccount(false);
      setStep('review');
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function onboard() {
    setBusy(true); setError('');
    try {
      const r = await api<OnboardResult>('/api/onboarding/complete', {
        method: 'POST',
        body: {
          mgmtIp: form.mgmtIp.trim(), username: form.username.trim(), password: form.password,
          enablePassword: form.enablePassword || undefined,
          siteId: form.siteId || undefined, location: form.location || undefined,
          createAccount,
          applyBaseline: baselineComplete ? false : applyBaseline
        }
      });
      setResult(r);
      setStep('done');
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal title="Add switch" onClose={onClose}>
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">{error}</div>
      )}

      {step === 'creds' && (
        <>
          <p className="mb-4 text-sm text-slate-500">
            Enter the management IP and an account with management privileges. SwitchPilot connects
            over SSH, identifies the switch, and reviews its config before changing anything.
          </p>
          <Field label="Management IP">
            <input className={inputCls} value={form.mgmtIp} onChange={set('mgmtIp')} placeholder="192.168.10.100" autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Username">
              <input className={inputCls} value={form.username} onChange={set('username')} placeholder="admin" />
            </Field>
            <Field label="Password">
              <input className={inputCls} type="password" value={form.password} onChange={set('password')} />
            </Field>
          </div>
          <Field label="Enable password (only if different)">
            <input className={inputCls} type="password" value={form.enablePassword} onChange={set('enablePassword')} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Site">
              <select className={inputCls} value={form.siteId} onChange={set('siteId')}>
                <option value="">—</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Location">
              <input className={inputCls} value={form.location} onChange={set('location')} placeholder="IDF-2, rack 4" />
            </Field>
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={analyze} disabled={busy || !form.mgmtIp.trim() || !form.username.trim() || !form.password}>
              {busy ? 'Connecting…' : 'Analyze switch'}
            </Button>
          </div>
        </>
      )}

      {step === 'review' && analysis && (
        <>
          <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-sm">
            <div className="font-medium text-slate-800">{analysis.identity.hostname || form.mgmtIp}</div>
            <div className="mt-0.5 font-mono text-xs text-slate-500">
              {analysis.identity.model} · {analysis.identity.iosVersion} · SN {analysis.identity.serial}
            </div>
            {analysis.hostKeyFingerprint && (
              <div className="mt-2 border-t border-slate-200 pt-2">
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">SSH host key</div>
                <div className="mt-0.5 break-all font-mono text-xs text-slate-600">{analysis.hostKeyFingerprint}</div>
                <div className="mt-0.5 text-[11px] text-slate-400">
                  Verify this matches the switch (e.g. <span className="font-mono">ssh-keygen -lf</span> on its host key)
                  before onboarding. It is pinned on first connect; a later change is then refused.
                </div>
              </div>
            )}
          </div>

          {requirementsMet && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2.5 text-sm font-medium text-green-800">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-200 text-xs font-bold text-green-800">✓</span>
              This switch already meets the onboarding requirements.
            </div>
          )}

          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Config review</div>
          <div className="mb-4 space-y-1.5">
            {analysis.checklist.map(c => (
              <div key={c.key} className="flex items-start gap-2.5 rounded-lg border border-slate-100 px-3 py-2">
                {c.present ? (
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-green-100 text-[10px] font-bold text-green-700">✓</span>
                ) : (
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-700">!</span>
                )}
                <div className="min-w-0">
                  <div className="text-sm text-slate-700">
                    {c.label}
                    {!c.present && <span className="ml-2 text-xs font-medium text-amber-600">missing</span>}
                  </div>
                  <div className="text-xs text-slate-400">{c.why}</div>
                </div>
              </div>
            ))}
          </div>

          {isMikrotik ? (
            <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
              RouterOS device - SwitchPilot will manage it with the "{form.username}" account you provided.
              There is no separate platform account to create.
            </div>
          ) : (
          <>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Admin accounts</div>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {analysis.users.map(u => (
              <span key={u.name}
                className={`rounded px-2 py-0.5 font-mono text-xs ${u.priv15 ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' : 'bg-slate-100 text-slate-500'}`}>
                {u.name}{u.priv15 ? ' (priv 15)' : ''}
              </span>
            ))}
            {analysis.users.length === 0 && <span className="text-xs text-slate-400">none found in running config</span>}
          </div>

          {analysis.usingPlatformAccount ? (
            <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
              You supplied the SPAdmin account - SwitchPilot will use it as-is.
              {analysis.otherAdmins.length === 0 &&
                ' Warning: no other privilege-15 account exists. Create a break-glass admin so you cannot be locked out.'}
            </div>
          ) : analysis.spAdminExists ? (
            <div className="mb-3 flex items-start gap-2.5 rounded-lg border border-green-200 bg-green-50 p-3">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-green-200 text-[10px] font-bold text-green-800">✓</span>
              <span className="text-sm">
                <span className="font-medium text-green-800">SPAdmin account already present</span>
                <span className="mt-0.5 block text-xs text-green-700">
                  Account creation is disabled so its password isn't reset out from under you.
                  Onboard with the "{form.username}" account (used as-is), or go back and enter the
                  existing SPAdmin credentials directly to manage as SPAdmin.
                </span>
              </span>
            </div>
          ) : (
            <label className="mb-3 flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <input type="checkbox" className="mt-0.5 rounded border-slate-300"
                     checked={createAccount} onChange={e => setCreateAccount(e.target.checked)} />
              <span className="text-sm">
                <span className="font-medium text-slate-700">Create dedicated SPAdmin account</span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  Adds a <span className="font-mono">SPAdmin</span> privilege-15 user with a random password
                  (stored encrypted), verifies it can log in, and uses it for all future management - so
                  platform changes are attributable in the switch's logs instead of appearing as
                  "{form.username}". Your "{form.username}" account is untouched.
                </span>
              </span>
            </label>
          )}
          </>
          )}

          {baselineComplete ? (
            <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-green-200 bg-green-50 p-3">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-green-200 text-[10px] font-bold text-green-800">✓</span>
              <span className="text-sm">
                <span className="font-medium text-green-800">Baseline already applied</span>
                <span className="mt-0.5 block text-xs text-green-700">
                  All baseline items are present - nothing to push.
                </span>
              </span>
            </div>
          ) : (
            <label className="mb-4 flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <input type="checkbox" className="mt-0.5 rounded border-slate-300"
                     checked={applyBaseline} onChange={e => setApplyBaseline(e.target.checked)} />
              <span className="text-sm">
                <span className="font-medium text-slate-700">Apply missing baseline config</span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  Pushes the items marked missing above as a job (with a pre-change backup).
                </span>
              </span>
            </label>
          )}

          <div className="flex justify-between gap-2">
            <Button variant="secondary" onClick={() => setStep('creds')}>Back</Button>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button onClick={onboard} disabled={busy}>{busy ? 'Onboarding & scanning…' : 'Onboard switch'}</Button>
            </div>
          </div>
        </>
      )}

      {step === 'done' && result && (
        <>
          <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            <span className="font-medium">{result.device.hostname}</span> onboarded successfully.
          </div>

          {result.generatedPassword && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <div className="text-sm font-medium text-amber-800">SPAdmin password (shown once)</div>
              <div className="mt-1 text-xs text-amber-700">
                Stored encrypted in SwitchPilot - save it in your password manager as a backup.
              </div>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 rounded bg-white px-3 py-2 font-mono text-sm ring-1 ring-amber-200">
                  {result.generatedPassword}
                </code>
                <Button variant="secondary" onClick={() => {
                  navigator.clipboard.writeText(result.generatedPassword!);
                  setCopied(true);
                }}>{copied ? 'Copied ✓' : 'Copy'}</Button>
              </div>
            </div>
          )}

          {result.warnings.map((w, i) => (
            <div key={i} className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">{w}</div>
          ))}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Close</Button>
            <Button onClick={() => { onClose(); navigate(`/devices/${result.device.id}`); }}>Open device</Button>
          </div>
        </>
      )}
    </Modal>
  );
}
