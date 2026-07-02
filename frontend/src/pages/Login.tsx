import { useState } from 'react';
import { api, setToken } from '../api';
import { LogoMark } from '../components/Logo';
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
        {/* Brand */}
        <div className="mb-6 flex flex-col items-center">
          <LogoMark className="mb-3 h-16 w-16 drop-shadow-lg" />
          <h1 className="text-2xl font-bold tracking-tight text-white">SwitchPilot</h1>
          <p className="mt-1 text-sm text-slate-400">Network Management</p>
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
            <label htmlFor="login-username" className="mb-1.5 block text-sm font-medium text-slate-700">Username</label>
            <input
              id="login-username"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
            />
          </div>

          <div className="mb-5">
            <label htmlFor="login-password" className="mb-1.5 block text-sm font-medium text-slate-700">Password</label>
            <input
              id="login-password"
              type="password"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          {mfaRequired && (
            <div className="mb-5">
              <label htmlFor="login-totp" className="mb-1.5 block text-sm font-medium text-slate-700">MFA code</label>
              <input
                id="login-totp"
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

        {/* AGPL §13 source offer: users interacting over the network must be
            able to reach the Corresponding Source. Forks should point this at
            their own repository. */}
        <p className="mt-4 text-center text-xs text-slate-500">
          <a href="https://github.com/bpifer/switchpilot" target="_blank" rel="noreferrer"
             className="hover:text-slate-300 hover:underline">
            SwitchPilot is free software (AGPL-3.0) — source code
          </a>
        </p>
      </div>
    </div>
  );
}
