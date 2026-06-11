import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import { api, getToken, setToken } from './api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Devices from './pages/Devices';
import DeviceDetail from './pages/DeviceDetail';
import Templates from './pages/Templates';
import Jobs from './pages/Jobs';
import Alerts from './pages/Alerts';
import Topology from './pages/Topology';
import Users from './pages/Users';

export interface Me {
  id: string;
  username: string;
  display_name: string;
  role: 'superadmin' | 'netadmin' | 'helpdesk' | 'readonly';
}

const NAV = [
  { to: '/', label: 'Dashboard', icon: '◧' },
  { to: '/devices', label: 'Devices', icon: '▤' },
  { to: '/topology', label: 'Topology', icon: '⬡' },
  { to: '/templates', label: 'Templates', icon: '≣' },
  { to: '/jobs', label: 'Jobs', icon: '⏱' },
  { to: '/alerts', label: 'Alerts', icon: '⚠' },
  { to: '/users', label: 'Users', icon: '👤', role: 'superadmin' }
];

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    if (!getToken()) { setLoading(false); return; }
    api<Me>('/api/auth/me')
      .then(setMe)
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex h-screen items-center justify-center text-gray-500">Loading…</div>;

  if (!me) {
    return (
      <Routes>
        <Route path="*" element={<Login onLogin={u => { setMe(u); navigate('/'); }} />} />
      </Routes>
    );
  }

  return (
    <div className="flex h-screen">
      <aside className="w-56 shrink-0 bg-brand-700 text-white flex flex-col">
        <div className="px-5 py-4 text-lg font-semibold tracking-wide border-b border-brand-600">
          SwitchPilot
        </div>
        <nav className="flex-1 py-3">
          {NAV.filter(n => !n.role || n.role === me.role).map(n => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-brand-600 ${isActive ? 'bg-brand-600 font-medium' : 'text-brand-100'}`}
            >
              <span className="w-4 text-center">{n.icon}</span>{n.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-4 border-t border-brand-600 text-sm">
          <div className="font-medium">{me.display_name || me.username}</div>
          <div className="text-brand-100 text-xs capitalize">{me.role}</div>
          <button
            className="mt-2 text-xs underline text-brand-100 hover:text-white"
            onClick={() => { setToken(null); setMe(null); }}
          >Sign out</button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/devices" element={<Devices me={me} />} />
          <Route path="/devices/:id" element={<DeviceDetail me={me} />} />
          <Route path="/templates" element={<Templates me={me} />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/alerts" element={<Alerts me={me} />} />
          <Route path="/topology" element={<Topology />} />
          {me.role === 'superadmin' && <Route path="/users" element={<Users />} />}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}
