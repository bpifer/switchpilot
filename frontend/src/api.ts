// Thin fetch wrapper with JWT handling.
let token: string | null = localStorage.getItem('sp_token');

export function setToken(t: string | null): void {
  token = t;
  if (t) localStorage.setItem('sp_token', t);
  else localStorage.removeItem('sp_token');
}

export function getToken(): string | null {
  return token;
}

// Sliding session: while logged in, exchange the token for a fresh one every
// 30 minutes so an open dashboard never hits a silent mid-session expiry.
const REFRESH_INTERVAL_MS = 30 * 60_000;
setInterval(async () => {
  if (!token) return;
  try {
    const { token: fresh } = await api<{ token: string }>('/api/auth/refresh', { method: 'POST' });
    if (fresh) setToken(fresh);
  } catch { /* a 401 here already redirected to login */ }
}, REFRESH_INTERVAL_MS);

export class ApiError extends Error {
  constructor(public status: number, message: string, public detail?: unknown) {
    super(message);
  }
}

export async function api<T = any>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const res = await fetch(path, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
  if (res.status === 401 && !path.startsWith('/api/auth/login')) {
    setToken(null);
    window.location.href = '/login';
    throw new ApiError(401, 'Session expired');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? res.statusText, data.detail);
  return data as T;
}
