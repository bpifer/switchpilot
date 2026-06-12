import { useState } from 'react';
import { api, setToken } from '../api';
import type { Me } from '../App';

export default function Login({ onLogin }: { onLogin: (me: Me) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await api<{ token: string; user: any }>('/api/auth/login', {
        method: 'POST',
        body: { username, password, ...(totp ? { totp } : {}) }
      });
      setToken(res.token);
      // /me carries must_change_password and mfa_setup_required; App's SecurityGate
      // enforces them, so we just hand off the fresh profile.
      const me = await api<Me>('/api/auth/me');
      onLogin(me);
    } catch (err: any) {
      if (err.message?.includes('MFA code required')) setMfaRequired(true);
      else setError(err.message ?? 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-brand-900 px-4">
      <div className="w-full max-w-sm">
        {/* Logo card */}
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-500 shadow-lg">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                 strokeWidth={1.5} stroke="white" className="h-7 w-7">
              <path strokeLinecap="round" strokeLinejoin="round"
                    d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">SwitchPilot</h1>
          <p className="mt-1 text-sm text-slate-400">Cisco switch management</p>
        </div>

        {/* Form card */}
        <form
          onSubmit={submit}
          className="rounded-2xl bg-white p-8 shadow-2xl ring-1 ring-white/10"
        >
          {error && (
            <div className="mb-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">
              {error}
            </div>
          )}

          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Username</label>
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
            />
          </div>

          <div className="mb-5">
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Password</label>
            <input
              type="password"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          {mfaRequired && (
            <div className="mb-5">
              <label className="mb-1.5 block text-sm font-medium text-slate-700">MFA code</label>
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                value={totp}
                onChange={e => setTotp(e.target.value)}
                autoFocus
              />
              <p className="mt-1 text-xs text-slate-400">6-digit authenticator code, or a saved recovery code.</p>
            </div>
          )}

          <button
            disabled={busy}
            className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-60"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
