import { useState } from 'react';
import { api, setToken } from '../api';
import type { Me } from '../App';

/**
 * Blocking screen shown after login when policy requires the user to change
 * their password and/or enroll in MFA before they can use the app.
 * Handles one requirement at a time; onComplete refetches `me` so App re-evaluates.
 */
export default function SecurityGate({ me, onComplete, onLogout }: {
  me: Me; onComplete: () => void; onLogout: () => void;
}) {
  const needPassword = !!me.must_change_password;
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-brand-900 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-white">Secure your account</h1>
          <p className="mt-1 text-sm text-slate-400 dark:text-slate-500">
            {needPassword ? 'A password change is required before you continue.'
              : 'Multi-factor authentication is required for your role.'}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-8 shadow-2xl ring-1 ring-white/10 dark:bg-slate-800">
          {needPassword
            ? <ChangePassword onDone={onComplete} />
            : <EnrollMfa username={me.username} onDone={onComplete} />}
          <button onClick={onLogout} className="mt-4 w-full text-center text-xs text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-400">
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-brand-400/30';

function ChangePassword({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (next !== confirm) { setError('New passwords do not match'); return; }
    setBusy(true);
    try {
      // Changing the password revokes every other session; the response's
      // fresh token keeps THIS session alive across the revocation.
      const res = await api<{ token?: string }>('/api/auth/change-password',
        { method: 'POST', body: { currentPassword: current, newPassword: next } });
      if (res.token) setToken(res.token);
      onDone();
    } catch (err: any) { setError(err.message ?? 'Could not change password'); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20">{error}</div>}
      <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Current password</label>
      <input type="password" className={`${inputCls} mb-4`} value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" autoFocus />
      <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">New password</label>
      <input type="password" className={`${inputCls} mb-4`} value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" />
      <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Confirm new password</label>
      <input type="password" className={`${inputCls} mb-5`} value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" />
      <button disabled={busy} className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-60 dark:bg-brand-500 dark:hover:bg-brand-400">
        {busy ? 'Saving…' : 'Change password'}
      </button>
    </form>
  );
}

function EnrollMfa({ username, onDone }: { username: string; onDone: () => void }) {
  const [secret, setSecret] = useState('');
  const [otpauth, setOtpauth] = useState('');
  const [totp, setTotp] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function begin() {
    setBusy(true); setError('');
    try {
      const r = await api<{ secret: string; otpauthUrl: string }>('/api/auth/mfa/setup', { method: 'POST' });
      setSecret(r.secret); setOtpauth(r.otpauthUrl);
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await api<{ ok: boolean; backupCodes?: string[] }>('/api/auth/mfa/confirm', { method: 'POST', body: { totp } });
      // Recovery codes are shown exactly once; the server stores only hashes.
      if (r.backupCodes?.length) setBackupCodes(r.backupCodes);
      else onDone();
    } catch (err: any) { setError(err.message ?? 'Invalid code'); }
    finally { setBusy(false); }
  }

  if (backupCodes) {
    return (
      <div>
        <p className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">MFA enabled. Save your recovery codes.</p>
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
          Each code signs you in once if you lose your authenticator. They are shown only now - store them somewhere safe.
        </p>
        <div className="mb-4 grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-3 font-mono text-sm text-slate-800 dark:bg-slate-700/50 dark:text-slate-100">
          {backupCodes.map(c => <span key={c}>{c}</span>)}
        </div>
        <button onClick={() => navigator.clipboard?.writeText(backupCodes.join('\n')).catch(() => {})}
                className="mb-2 w-full rounded-lg border border-slate-300 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800/50">
          Copy codes
        </button>
        <button onClick={onDone} className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-400">
          I saved them - continue
        </button>
      </div>
    );
  }

  if (!secret) {
    return (
      <div>
        {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">{error}</div>}
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
          Set up an authenticator app (Google Authenticator, Authy, 1Password, etc.) to generate sign-in codes.
        </p>
        <button onClick={begin} disabled={busy} className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60 dark:bg-brand-500 dark:hover:bg-brand-400">
          {busy ? 'Preparing…' : 'Begin MFA setup'}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={confirm}>
      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">{error}</div>}
      <p className="mb-2 text-sm text-slate-600 dark:text-slate-400">Add this secret to your authenticator app for <strong>{username}</strong>:</p>
      <div className="mb-3 break-all rounded-lg bg-slate-100 px-3 py-2 text-center font-mono text-sm tracking-wide text-slate-800 dark:bg-slate-700/50 dark:text-slate-100">{secret}</div>
      <details className="mb-4 text-xs text-slate-500 dark:text-slate-400">
        <summary className="cursor-pointer">Show otpauth:// URL</summary>
        <div className="mt-1 break-all rounded bg-slate-50 p-2 font-mono dark:bg-slate-800/50">{otpauth}</div>
      </details>
      <label htmlFor="mfa-totp" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Enter the 6-digit code</label>
      <input id="mfa-totp" className={`${inputCls} mb-5`} value={totp} inputMode="numeric" onChange={e => setTotp(e.target.value)} autoFocus />
      <button disabled={busy || totp.length < 6} className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60 dark:bg-brand-500 dark:hover:bg-brand-400">
        {busy ? 'Verifying…' : 'Enable MFA'}
      </button>
    </form>
  );
}
