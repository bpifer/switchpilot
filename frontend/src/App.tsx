import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import { api, getToken, setToken } from './api';
import { Icon } from './components/ui';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Devices from './pages/Devices';
import DeviceDetail from './pages/DeviceDetail';
import Templates from './pages/Templates';
import Jobs from './pages/Jobs';
import Alerts from './pages/Alerts';
import Topology from './pages/Topology';
import Users from './pages/Users';
import Analytics from './pages/Analytics';
import Clients from './pages/Clients';
import Maintenance from './pages/Maintenance';
import Discovery from './pages/Discovery';
import Locate from './pages/Locate';
import PoE from './pages/PoE';
import Lifecycle from './pages/Lifecycle';
import Campaigns from './pages/Campaigns';
import { useWebSocket } from './hooks/useWebSocket';

export interface Me {
  id: string;
  username: string;
  display_name: string;
  role: 'superadmin' | 'netadmin' | 'helpdesk' | 'readonly';
}

const ICONS: Record<string, string> = {
  dashboard: 'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z',
  devices:   'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10',
  topology:  'M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z',
  templates: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  jobs:      'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  alerts:    'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
  analytics: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z',
  clients:   'M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z',
  users:       'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
  maintenance: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  discovery:   'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7',
  locate:      'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z',
  poe:         'M13 10V3L4 14h7v7l9-11h-7z',
  lifecycle:   'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  campaigns:   'M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z',
};

const NAV = [
  { to: '/',          label: 'Dashboard', icon: ICONS.dashboard },
  { to: '/devices',   label: 'Devices',   icon: ICONS.devices },
  { to: '/topology',  label: 'Topology',  icon: ICONS.topology },
  { to: '/templates', label: 'Templates', icon: ICONS.templates },
  { to: '/jobs',      label: 'Jobs',      icon: ICONS.jobs },
  { to: '/alerts',    label: 'Alerts',    icon: ICONS.alerts },
  { to: '/analytics',   label: 'Analytics',   icon: ICONS.analytics },
  { to: '/clients',     label: 'Clients',     icon: ICONS.clients },
  { to: '/locate',      label: 'Locate',      icon: ICONS.locate },
  { to: '/poe',         label: 'PoE',         icon: ICONS.poe },
  { to: '/lifecycle',   label: 'Lifecycle',   icon: ICONS.lifecycle },
  { to: '/campaigns',   label: 'Campaigns',   icon: ICONS.campaigns },
  { to: '/maintenance', label: 'Maintenance', icon: ICONS.maintenance },
  { to: '/discovery',   label: 'Discovery',   icon: ICONS.discovery },
  { to: '/users',       label: 'Users',       icon: ICONS.users, role: 'superadmin' },
];

function Initials({ name }: { name: string }) {
  const parts = name.trim().split(/\s+/);
  const letters = parts.length >= 2
    ? parts[0][0] + parts[parts.length - 1][0]
    : name.slice(0, 2);
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500 text-xs font-semibold text-white uppercase">
      {letters}
    </span>
  );
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveAlertCount, setLiveAlertCount] = useState(0);
  const navigate = useNavigate();

  useWebSocket(msg => {
    if (msg.type === 'alert') setLiveAlertCount(n => n + 1);
  });

  useEffect(() => {
    if (!getToken()) { setLoading(false); return; }
    api<Me>('/api/auth/me')
      .then(setMe)
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <svg className="h-8 w-8 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm">Loading…</span>
        </div>
      </div>
    );
  }

  if (!me) {
    return (
      <Routes>
        <Route path="*" element={<Login onLogin={u => { setMe(u); navigate('/'); }} />} />
      </Routes>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50">
      <aside className="flex w-60 shrink-0 flex-col bg-slate-900 text-white">
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-800">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500">
            <Icon d={ICONS.devices} className="h-4 w-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold leading-none">SwitchPilot</div>
            <div className="mt-0.5 text-[10px] text-slate-400 leading-none">Network Management</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2">
          {NAV.filter(n => !n.role || n.role === me.role).map(n => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors mb-0.5 ${
                  isActive
                    ? 'bg-white/10 text-white font-medium'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon d={n.icon} className={`h-4 w-4 shrink-0 ${isActive ? 'text-brand-400' : ''}`} />
                  <span className="flex-1">{n.label}</span>
                  {n.to === '/alerts' && liveAlertCount > 0 && (
                    <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                      {liveAlertCount > 99 ? '99+' : liveAlertCount}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* User */}
        <div className="border-t border-slate-800 px-4 py-4">
          <div className="flex items-center gap-3">
            <Initials name={me.display_name || me.username} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-slate-100">
                {me.display_name || me.username}
              </div>
              <div className="text-xs capitalize text-slate-400">{me.role}</div>
            </div>
          </div>
          <button
            className="mt-3 w-full rounded-lg px-3 py-1.5 text-xs text-slate-400 transition hover:bg-white/5 hover:text-slate-200 text-left"
            onClick={() => { setToken(null); setMe(null); }}
          >
            Sign out
          </button>
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
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/locate" element={<Locate />} />
          <Route path="/poe" element={<PoE />} />
          <Route path="/lifecycle" element={<Lifecycle me={me} />} />
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/maintenance" element={<Maintenance />} />
          <Route path="/discovery" element={<Discovery />} />
          {me.role === 'superadmin' && <Route path="/users" element={<Users />} />}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}
