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
      const me = await api<Me>('/api/auth/me');
      if (res.user.mustChangePassword) {
        alert('Your password must be changed. Use your profile/API to set a new password (minimum 12 characters).');
      }
      onLogin(me);
    } catch (err: any) {
      if (err.message?.includes('MFA code required')) setMfaRequired(true);
      else setError(err.message ?? 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-gray-100">
      <form onSubmit={submit} className="w-96 rounded-xl bg-white p-8 shadow">
        <h1 className="mb-1 text-2xl font-semibold text-brand-700">SwitchPilot</h1>
        <p className="mb-6 text-sm text-gray-500">Cisco switch management</p>
        {error && <div className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <label className="mb-1 block text-sm font-medium">Username</label>
        <input className="mb-4 w-full rounded border px-3 py-2" value={username}
               onChange={e => setUsername(e.target.value)} autoFocus />
        <label className="mb-1 block text-sm font-medium">Password</label>
        <input type="password" className="mb-4 w-full rounded border px-3 py-2" value={password}
               onChange={e => setPassword(e.target.value)} />
        {mfaRequired && (
          <>
            <label className="mb-1 block text-sm font-medium">MFA code</label>
            <input className="mb-4 w-full rounded border px-3 py-2" value={totp} inputMode="numeric"
                   onChange={e => setTotp(e.target.value)} autoFocus />
          </>
        )}
        <button disabled={busy}
                className="w-full rounded bg-brand-600 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
