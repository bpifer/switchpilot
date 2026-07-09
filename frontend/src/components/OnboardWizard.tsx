// Multi-step switch onboarding wizard.
// Step 1 (connect): pick vendor, enter connection details, verify the device.
// Step 2 (place):   site & location + vendor-specific options (SPAdmin, baseline).
// Step 3 (done):    success summary.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useSiteScope } from '../context/SiteContext';
import { Modal, Button, Field, inputCls } from './ui';

// ── Types ─────────────────────────────────────────────────────────────────────

type Vendor = 'cisco' | 'mikrotik' | 'aruba';
type Step = 'connect' | 'place' | 'done';

interface DeviceIdentity {
  hostname: string;
  model: string;
  serial: string;
  iosVersion: string;
}

// Shape returned by /api/onboarding/analyze (cisco + mikrotik)
interface Analysis {
  vendor: string;
  identity: DeviceIdentity;
  users: { name: string; priv15: boolean }[];
  checklist: { key: string; label: string; present: boolean; why: string }[];
  usingPlatformAccount: boolean;
  spAdminExists: boolean;
  otherAdmins: string[];
  hostKeyFingerprint?: string;
}

// Shape returned by /api/onboarding/probe-aruba
interface ArubaProbe {
  vendor: 'aruba';
  identity: DeviceIdentity;
  sysDescr: string;
  uptimeSeconds: number;
}

interface OnboardResult {
  device: any;
  account: string;
  generatedPassword: string | null;
  warnings: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const VENDOR_LABELS: Record<Vendor, string> = {
  cisco:    'Cisco (IOS / IOS-XE / NX-OS)',
  mikrotik: 'MikroTik (RouterOS)',
  aruba:    'Aruba Instant On',
};

function StepIndicator({ current, total, label }: { current: number; total: number; label: string }) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <div className="flex items-center gap-1.5">
        {Array.from({ length: total }, (_, i) => (
          <span key={i}
            className={`h-1.5 rounded-full transition-all ${
              i + 1 < current  ? 'w-6 bg-brand-500'
            : i + 1 === current ? 'w-8 bg-brand-600'
            :                     'w-4 bg-slate-200 dark:bg-slate-700'
            }`}
          />
        ))}
      </div>
      <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
        Step {current} of {total} — {label}
      </span>
    </div>
  );
}

function DeviceCard({ identity, vendor, fingerprint }: {
  identity: DeviceIdentity; vendor: string; fingerprint?: string;
}) {
  const vendorLabel = vendor === 'aruba' ? 'Aruba Instant On' : vendor === 'mikrotik' ? 'MikroTik' : 'Cisco';
  return (
    <div className="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-500/20 dark:bg-green-500/10">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-200 text-xs font-bold text-green-800 dark:bg-green-500/20 dark:text-green-400">✓</span>
        <div className="min-w-0">
          <div className="font-medium text-green-800 dark:text-green-300">
            {identity.hostname || 'Device reachable'}
          </div>
          <div className="mt-0.5 font-mono text-xs text-green-700 dark:text-green-400">
            {[vendorLabel, identity.model, identity.iosVersion && `v${identity.iosVersion}`, identity.serial && `SN ${identity.serial}`]
              .filter(Boolean).join(' · ')}
          </div>
        </div>
      </div>
      {fingerprint && (
        <div className="mt-2.5 border-t border-green-200 pt-2.5 dark:border-green-500/20">
          <div className="text-[11px] font-medium uppercase tracking-wide text-green-700 dark:text-green-500">SSH host key fingerprint</div>
          <div className="mt-0.5 break-all font-mono text-xs text-green-700 dark:text-green-400">{fingerprint}</div>
          <div className="mt-0.5 text-[11px] text-green-600/70 dark:text-green-500/70">
            Verify this matches the switch before onboarding. It is pinned on first connect — a later change is refused.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function OnboardWizard({ sites, onClose, initialIp = '' }: {
  sites: any[]; onClose: () => void; initialIp?: string;
}) {
  const [step, setStep] = useState<Step>('connect');
  const [vendor, setVendor] = useState<Vendor>('cisco');
  const { siteId: scopeSite } = useSiteScope();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    mgmtIp:         initialIp,
    username:        '',
    password:        '',
    enablePassword:  '',
    snmpCommunity:   '',
    siteId:          scopeSite !== 'unassigned' ? scopeSite : '',
    location:        '',
  });
  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }));

  // Analysis result from step 1 probe (kept for display + forwarded to complete)
  const [analysis, setAnalysis] = useState<Analysis | ArubaProbe | null>(null);

  // Step-2 Cisco/MikroTik options
  const [createAccount, setCreateAccount] = useState(true);
  const [applyBaseline, setApplyBaseline] = useState(true);

  const [result, setResult] = useState<OnboardResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  // ── Step 1: verify the device ─────────────────────────────────────────────

  const canConnect =
    !!form.mgmtIp.trim() && (
      vendor === 'aruba'
        ? !!form.snmpCommunity.trim()
        : !!form.username.trim() && !!form.password
    );

  async function connect() {
    setBusy(true); setError('');
    try {
      if (vendor === 'aruba') {
        const a = await api<ArubaProbe>('/api/onboarding/probe-aruba', {
          method: 'POST',
          body: { mgmtIp: form.mgmtIp.trim(), snmpCommunity: form.snmpCommunity.trim() },
        });
        setAnalysis(a);
      } else {
        const a = await api<Analysis>('/api/onboarding/analyze', {
          method: 'POST',
          body: {
            mgmtIp: form.mgmtIp.trim(),
            username: form.username.trim(),
            password: form.password,
            enablePassword: form.enablePassword || undefined,
          },
        });
        setAnalysis(a);
        if (a.vendor === 'mikrotik' || a.usingPlatformAccount || a.spAdminExists) {
          setCreateAccount(false);
        }
      }
      setStep('place');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // ── Step 2: add the switch ────────────────────────────────────────────────

  async function add() {
    setBusy(true); setError('');
    try {
      let body: any;
      if (vendor === 'aruba') {
        body = {
          vendor: 'aruba',
          mgmtIp: form.mgmtIp.trim(),
          snmpCommunity: form.snmpCommunity.trim(),
          siteId: form.siteId || undefined,
          location: form.location || undefined,
        };
      } else {
        const ciscoAnalysis = analysis as Analysis;
        const baselineComplete = ciscoAnalysis?.checklist?.every(c => c.present) ?? false;
        body = {
          mgmtIp: form.mgmtIp.trim(),
          username: form.username.trim(),
          password: form.password,
          enablePassword: form.enablePassword || undefined,
          siteId: form.siteId || undefined,
          location: form.location || undefined,
          createAccount,
          applyBaseline: baselineComplete ? false : applyBaseline,
        };
      }
      const r = await api<OnboardResult>('/api/onboarding/complete', { method: 'POST', body });
      setResult(r);
      setStep('done');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // ── Computed values ───────────────────────────────────────────────────────

  const ciscoAnalysis  = (vendor !== 'aruba' && analysis) ? analysis as Analysis : null;
  const isMikroTik     = ciscoAnalysis?.vendor === 'mikrotik';
  const baselineComplete = ciscoAnalysis ? ciscoAnalysis.checklist.every(c => c.present) : true;
  const hasPlatformAccount = ciscoAnalysis
    ? isMikroTik || ciscoAnalysis.spAdminExists || ciscoAnalysis.usingPlatformAccount
    : true;

  // ── Render ────────────────────────────────────────────────────────────────

  const stepLabels: Record<Step, string> = {
    connect: 'Connect',
    place:   'Place & options',
    done:    'Done',
  };

  return (
    <Modal title="Add switch" onClose={onClose}>
      {step !== 'done' && <StepIndicator current={step === 'connect' ? 1 : 2} total={2} label={stepLabels[step]} />}

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20">
          {error}
        </div>
      )}

      {/* ── Step 1: connect ──────────────────────────────────────────────── */}
      {step === 'connect' && (
        <>
          {/* Vendor selector */}
          <div className="mb-4">
            <div className="mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">Vendor</div>
            <div className="flex flex-wrap gap-2">
              {(['cisco', 'mikrotik', 'aruba'] as Vendor[]).map(v => (
                <button key={v} type="button"
                  onClick={() => { setVendor(v); setError(''); }}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                    vendor === v
                      ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-400/60 dark:bg-brand-500/10 dark:text-brand-400'
                      : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:bg-slate-800/50'
                  }`}>
                  {VENDOR_LABELS[v]}
                </button>
              ))}
            </div>
          </div>

          <Field label="Management IP">
            <input className={inputCls} value={form.mgmtIp} onChange={set('mgmtIp')}
                   placeholder="192.168.10.100" autoFocus />
          </Field>

          {vendor === 'aruba' ? (
            <>
              <Field label="SNMP community string">
                <input className={inputCls} value={form.snmpCommunity} onChange={set('snmpCommunity')}
                       placeholder="public" autoComplete="off" />
              </Field>
              <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">
                Aruba Instant On switches are managed via SNMP — no SSH credentials are needed or stored.
                Make sure SNMP is enabled on the switch and the community string matches.
              </p>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Username">
                  <input className={inputCls} value={form.username} onChange={set('username')} placeholder="admin" />
                </Field>
                <Field label="Password">
                  <input className={inputCls} type="password" value={form.password} onChange={set('password')} />
                </Field>
              </div>
              {vendor === 'cisco' && (
                <Field label="Enable password (only if different from login password)">
                  <input className={inputCls} type="password" value={form.enablePassword}
                         onChange={set('enablePassword')} />
                </Field>
              )}
              <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">
                {vendor === 'mikrotik'
                  ? 'SwitchPilot connects over SSH and identifies the RouterOS device before adding it.'
                  : 'SwitchPilot connects over SSH, identifies the switch, and reviews its config before changing anything.'}
              </p>
            </>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={connect} disabled={busy || !canConnect}>
              {busy ? 'Connecting…' : 'Connect & verify'}
            </Button>
          </div>
        </>
      )}

      {/* ── Step 2: place & options ───────────────────────────────────────── */}
      {step === 'place' && analysis && (
        <>
          {/* Verified device card */}
          <DeviceCard
            identity={analysis.identity}
            vendor={analysis.vendor ?? vendor}
            fingerprint={ciscoAnalysis?.hostKeyFingerprint}
          />

          {/* Cisco/MikroTik config review */}
          {ciscoAnalysis && (
            <>
              <div className="mt-4 mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Config review
              </div>
              <div className="mb-3 space-y-1.5">
                {ciscoAnalysis.checklist.map(c => (
                  <div key={c.key} className="flex items-start gap-2.5 rounded-lg border border-slate-100 px-3 py-2 dark:border-slate-800">
                    {c.present ? (
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-green-100 text-[10px] font-bold text-green-700 dark:bg-green-500/10 dark:text-green-400">✓</span>
                    ) : (
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">!</span>
                    )}
                    <div className="min-w-0">
                      <div className="text-sm text-slate-700 dark:text-slate-300">
                        {c.label}
                        {!c.present && <span className="ml-2 text-xs font-medium text-amber-600 dark:text-amber-400">missing</span>}
                      </div>
                      <div className="text-xs text-slate-400 dark:text-slate-500">{c.why}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* SPAdmin account options (Cisco only) */}
              {!isMikroTik && (
                ciscoAnalysis.usingPlatformAccount ? (
                  <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-500/10 dark:text-blue-400">
                    You supplied the SPAdmin account — SwitchPilot will use it as-is.
                  </div>
                ) : ciscoAnalysis.spAdminExists ? (
                  <div className="mb-3 flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 p-3 dark:bg-green-500/10">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-green-200 text-[10px] font-bold text-green-800 dark:text-green-400">✓</span>
                    <span className="text-sm">
                      <span className="font-medium text-green-800 dark:text-green-400">SPAdmin account already present</span>
                      <span className="mt-0.5 block text-xs text-green-700 dark:text-green-400">
                        Account creation disabled — password won't be reset. Onboard with "{form.username}" or go back and supply SPAdmin credentials directly.
                      </span>
                    </span>
                  </div>
                ) : (
                  <label className="mb-3 flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40">
                    <input type="checkbox" className="mt-0.5 rounded" checked={createAccount}
                           onChange={e => setCreateAccount(e.target.checked)} />
                    <span className="text-sm">
                      <span className="font-medium text-slate-700 dark:text-slate-300">Create dedicated SPAdmin account</span>
                      <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                        Adds a <span className="font-mono">SPAdmin</span> privilege-15 user (random password, stored encrypted)
                        so platform changes are attributable in the switch's own logs.
                        Your "{form.username}" account is untouched.
                      </span>
                    </span>
                  </label>
                )
              )}

              {/* Baseline */}
              {!baselineComplete && (
                <label className="mb-3 flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40">
                  <input type="checkbox" className="mt-0.5 rounded" checked={applyBaseline}
                         onChange={e => setApplyBaseline(e.target.checked)} />
                  <span className="text-sm">
                    <span className="font-medium text-slate-700 dark:text-slate-300">Apply missing baseline config</span>
                    <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                      Pushes the items marked missing above (with a pre-change backup).
                    </span>
                  </span>
                </label>
              )}

              {isMikroTik && (
                <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-500/10 dark:text-blue-400">
                  RouterOS device — SwitchPilot will manage it with the "{form.username}" account you provided.
                </div>
              )}
            </>
          )}

          {/* Aruba note */}
          {vendor === 'aruba' && (
            <div className="mt-3 mb-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-500/10 dark:text-blue-400">
              Managed via SNMP — no SSH credentials stored. Port configuration changes use SNMP writes (Q-BRIDGE / IF-MIB).
            </div>
          )}

          {/* Site & location */}
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Site">
              <select className={inputCls} value={form.siteId} onChange={set('siteId')}>
                <option value="">—</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Location">
              <input className={inputCls} value={form.location} onChange={set('location')}
                     placeholder="IDF-2, rack 4" />
            </Field>
          </div>

          <div className="mt-2 flex justify-between gap-2">
            <Button variant="secondary"
                    onClick={() => { setStep('connect'); setAnalysis(null); setError(''); }}>
              Back
            </Button>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button onClick={add} disabled={busy}>
                {busy ? 'Adding switch…' : 'Add switch'}
              </Button>
            </div>
          </div>
        </>
      )}

      {/* ── Step 3: done ─────────────────────────────────────────────────── */}
      {step === 'done' && result && (
        <>
          <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:bg-green-500/10 dark:text-green-400">
            <span className="font-medium">{result.device.hostname || form.mgmtIp}</span> added successfully.
          </div>

          {result.generatedPassword && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:bg-amber-500/10">
              <div className="text-sm font-medium text-amber-800 dark:text-amber-400">SPAdmin password — shown once</div>
              <div className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                Stored encrypted in SwitchPilot. Save it in your password manager as a backup.
              </div>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 rounded bg-white px-3 py-2 font-mono text-sm ring-1 ring-amber-200 dark:bg-slate-800 dark:ring-amber-500/20">
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
            <div key={i} className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">{w}</div>
          ))}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Close</Button>
            <Button onClick={() => { onClose(); navigate(`/devices/${result.device.id}`); }}>
              Open device
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
