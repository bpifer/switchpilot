import { lazy, Suspense, useEffect, useState } from 'react';
import { Routes, Route, Navigate, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { api, getToken, setToken } from './api';
import { Icon } from './components/ui';
import Login from './pages/Login';
import SecurityGate from './pages/SecurityGate';
import ErrorBoundary from './components/ErrorBoundary';
import CommandPalette from './components/CommandPalette';
import { Toaster } from './components/Toast';
import { LogoMark } from './components/Logo';
import { useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from './hooks/useApiQuery';
import { useWebSocket } from './hooks/useWebSocket';
import { SiteScopeProvider, useSiteScope } from './context/SiteContext';

// Route-level code splitting: each page loads on first visit, keeping the
// initial bundle small (recharts alone is several hundred KB in Analytics).
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Devices = lazy(() => import('./pages/Devices'));
const DeviceDetail = lazy(() => import('./pages/DeviceDetail'));
const Templates = lazy(() => import('./pages/Templates'));
const Jobs = lazy(() => import('./pages/Jobs'));
const Alerts = lazy(() => import('./pages/Alerts'));
const Topology = lazy(() => import('./pages/Topology'));
const Rack = lazy(() => import('./pages/Rack'));
const Users = lazy(() => import('./pages/Users'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Traffic = lazy(() => import('./pages/Traffic'));
const Clients = lazy(() => import('./pages/Clients'));
const Maintenance = lazy(() => import('./pages/Maintenance'));
const Discovery = lazy(() => import('./pages/Discovery'));
const Lifecycle = lazy(() => import('./pages/Lifecycle'));
const Firmware = lazy(() => import('./pages/Firmware'));
const Logs = lazy(() => import('./pages/Logs'));
const Campaigns = lazy(() => import('./pages/Campaigns'));
const Compliance = lazy(() => import('./pages/Compliance'));
const Integrations = lazy(() => import('./pages/Integrations'));
const Sites = lazy(() => import('./pages/Sites'));

export interface Me {
  id: string;
  username: string;
  display_name: string;
  role: 'superadmin' | 'netadmin' | 'helpdesk' | 'readonly';
  mfa_enabled?: boolean;
  must_change_password?: boolean;
  mfa_setup_required?: boolean;
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
  traffic:   'M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.28m5.94 2.28-2.28 5.94',
  rack:      'M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.7 5.1a3 3 0 012.4-1.2h7.8a3 3 0 012.4 1.2l2.55 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z',
  users:       'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
  maintenance: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  discovery:   'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7',
  lifecycle:   'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  campaigns:   'M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z',
  compliance:  'M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  // chip / firmware
  firmware:    'M9 4.5V3m3 1.5V3m3 1.5V3M9 21v-1.5m3 1.5v-1.5m3 1.5v-1.5M4.5 9H3m1.5 3H3m1.5 3H3m18-6h-1.5m1.5 3h-1.5m1.5 3h-1.5M6.75 6.75h10.5v10.5H6.75V6.75zM9.75 9.75h4.5v4.5h-4.5v-4.5z',
  logs:        'M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z',
  // API / code brackets
  integrations:'M14.25 6.083 9.75 17.917M17.25 8.25 21 12l-3.75 3.75M6.75 8.25 3 12l3.75 3.75',
  // office building / sites
  sites:       'M3.75 21h16.5M4.5 3h9.75a.75.75 0 01.75.75V21H3.75V3.75A.75.75 0 014.5 3zM18 9h1.5a.75.75 0 01.75.75V21H15M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75',
};

interface NavItem { to: string; label: string; icon: string; role?: string }
interface NavSection { title?: string; items: NavItem[] }

const NAV: NavSection[] = [
  { items: [
    { to: '/',        label: 'Dashboard', icon: ICONS.dashboard },
    { to: '/alerts',  label: 'Alerts',    icon: ICONS.alerts },
  ]},
  { title: 'Network', items: [
    { to: '/devices',   label: 'Devices',   icon: ICONS.devices },
    { to: '/topology',  label: 'Topology',  icon: ICONS.topology },
    { to: '/rack',      label: 'Racks',     icon: ICONS.rack },
    { to: '/clients',   label: 'Clients',   icon: ICONS.clients },
    { to: '/discovery', label: 'Discovery', icon: ICONS.discovery },
    { to: '/logs',      label: 'Logs',      icon: ICONS.logs },
  ]},
  { title: 'Operations', items: [
    { to: '/jobs',        label: 'Jobs',        icon: ICONS.jobs },
    { to: '/templates',   label: 'Templates',   icon: ICONS.templates },
    { to: '/campaigns',   label: 'Campaigns',   icon: ICONS.campaigns },
    { to: '/maintenance', label: 'Maintenance', icon: ICONS.maintenance },
  ]},
  { title: 'Insights', items: [
    { to: '/analytics', label: 'Analytics', icon: ICONS.analytics },
    { to: '/traffic',   label: 'Traffic',   icon: ICONS.traffic },
  ]},
  { title: 'Organization', items: [
    { to: '/sites',        label: 'Sites',        icon: ICONS.sites },
    { to: '/compliance',   label: 'Compliance',   icon: ICONS.compliance },
    { to: '/lifecycle',    label: 'Lifecycle',    icon: ICONS.lifecycle },
    { to: '/firmware',     label: 'Firmware',     icon: ICONS.firmware },
    { to: '/integrations', label: 'Integrations', icon: ICONS.integrations, role: 'netadmin' },
    { to: '/users',        label: 'Admins',       icon: ICONS.users, role: 'superadmin' },
  ]},
];

const ROLE_RANK: Record<string, number> = { superadmin: 4, netadmin: 3, helpdesk: 2, readonly: 1 };
function roleRank(r: string): number { return ROLE_RANK[r] ?? 0; }

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

// Single source of truth for the open-alert count that drives BOTH the top-bar
// bell and the sidebar "Alerts" badge. Deliberately unscoped: a critical alert
// on another site must still light the indicators. Keyed by path, so the two
// consumers share one request/cache entry (and one 30s poll); ack/resolve on
// the Alerts page invalidates ['/api/summary'] to update both immediately.
function useOpenAlerts() {
  const { data: summary } = useApiQuery<{ openAlerts: Record<string, number> }>('/api/summary', { refetchInterval: 30000 });
  const open = summary ? Object.values(summary.openAlerts).reduce((a, b) => a + b, 0) : 0;
  const critical = (summary?.openAlerts?.critical ?? 0) > 0;
  return { open, critical };
}

function AlertsBell() {
  const navigate = useNavigate();
  const { open, critical } = useOpenAlerts();
  return (
    <button
      title={open > 0 ? `${open} open alert${open !== 1 ? 's' : ''} (all sites)` : 'No open alerts (all sites)'}
      onClick={() => navigate('/alerts')}
      className="relative rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
    >
      <Icon d={ICONS.alerts} className="h-5 w-5" />
      {open > 0 && (
        <span className={`absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white ${critical ? 'bg-red-500' : 'bg-amber-500'}`}>
          {open > 99 ? '99+' : open}
        </span>
      )}
    </button>
  );
}

function SiteSelector() {
  const { siteId, setSiteId } = useSiteScope();
  const { data: sites = [] } = useApiQuery<{ id: string; name: string }[]>('/api/sites');

  // Persisted site was deleted - fall back to all sites
  useEffect(() => {
    if (siteId && siteId !== 'unassigned' && sites.length > 0 && !sites.some(s => s.id === siteId)) {
      setSiteId('');
    }
  }, [sites, siteId]);

  return (
    <div className="border-b border-slate-800 px-3 py-2.5">
      <select
        value={siteId}
        onChange={e => setSiteId(e.target.value)}
        title="Scope pages to one site"
        className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-200
                   focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/40"
      >
        <option value="">All sites</option>
        {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        <option value="unassigned">Unassigned</option>
      </select>
    </div>
  );
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  // Mobile nav drawer: the sidebar is a static column on lg+, an off-canvas
  // drawer below that. Closes automatically on navigation (route change).
  const [navOpen, setNavOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => { setNavOpen(false); }, [location.pathname]);
  const queryClient = useQueryClient();
  // Same open-alert count the bell shows, so the sidebar "Alerts" badge and the
  // bell always agree and both clear the instant an alert is acked/resolved.
  const { open: openAlerts } = useOpenAlerts();

  const wsStatus = useWebSocket(msg => {
    if (msg.type === 'alert') {
      // A new alert fired: refresh the shared open-alert count that drives the
      // bell and the sidebar badge.
      queryClient.invalidateQueries({ queryKey: ['/api/summary'] });
    } else if (msg.type === 'device_updated') {
      // A monitor sweep refreshed this device (or its status flipped): refetch
      // whatever is on screen for it - detail, ports, metrics - plus the device
      // list. Only ACTIVE queries refetch, so background pages cost nothing.
      const { deviceId } = msg.data;
      queryClient.invalidateQueries({
        predicate: q => {
          const k = String(q.queryKey[0] ?? '');
          return k.startsWith(`/api/devices/${deviceId}`) || k === '/api/devices' || k.startsWith('/api/devices?');
        }
      });
    }
  }, !!me);

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

  // Forced security steps: a change-password or MFA-enrollment requirement blocks
  // the app until satisfied.
  if (me.must_change_password || me.mfa_setup_required) {
    return (
      <SecurityGate
        me={me}
        onComplete={() => api<Me>('/api/auth/me').then(setMe).catch(() => setToken(null))}
        onLogout={() => { setToken(null); setMe(null); }}
      />
    );
  }

  return (
    <SiteScopeProvider>
    <CommandPalette />
    <Toaster />
    <div className="flex h-screen bg-slate-50">
      {/* Mobile drawer backdrop */}
      {navOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" aria-hidden onClick={() => setNavOpen(false)} />
      )}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-60 shrink-0 flex-col bg-slate-900 text-white transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0 ${navOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-800">
          <LogoMark className="h-9 w-9 shrink-0" />
          <div className="flex-1">
            <div className="text-sm font-semibold leading-none">SwitchPilot</div>
            <div className="mt-0.5 text-[10px] text-slate-400 leading-none">Network Management</div>
          </div>
          <AlertsBell />
          {/* Close drawer (mobile only) */}
          <button className="lg:hidden -mr-1 rounded p-1 text-slate-400 hover:text-white" aria-label="Close menu" onClick={() => setNavOpen(false)}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Site scope */}
        <SiteSelector />

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2">
          {NAV.map((section, si) => {
            const items = section.items.filter(n => !n.role || roleRank(me.role) >= roleRank(n.role));
            if (items.length === 0) return null;
            return (
              <div key={section.title ?? si} className={si > 0 ? 'mt-4' : ''}>
                {section.title && (
                  <div className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {section.title}
                  </div>
                )}
                {items.map(n => (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    end={n.to === '/'}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors mb-0.5 ${
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
                        {n.to === '/alerts' && openAlerts > 0 && (
                          <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                            {openAlerts > 99 ? '99+' : openAlerts}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        {/* Connection status */}
        <div className="border-t border-slate-800 px-4 py-2">
          <div className="flex items-center gap-2 text-xs">
            <span className={`h-1.5 w-1.5 rounded-full ${
              wsStatus === 'live' ? 'bg-green-500'
              : wsStatus === 'connecting' ? 'bg-amber-400 animate-pulse'
              : 'bg-slate-500 animate-pulse'}`} />
            <span className={wsStatus === 'live' ? 'text-slate-400' : 'text-amber-400'}>
              {wsStatus === 'live' ? 'Live' : wsStatus === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
            </span>
          </div>
        </div>

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

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar (hidden on lg+, where the sidebar is always visible) */}
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5 lg:hidden">
          <button className="-ml-1 rounded-lg p-1.5 text-slate-600 hover:bg-slate-100" aria-label="Open menu" onClick={() => setNavOpen(true)}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="h-6 w-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
            </svg>
          </button>
          <LogoMark className="h-7 w-7 shrink-0" />
          <span className="font-semibold text-slate-800">SwitchPilot</span>
          <div className="ml-auto"><AlertsBell /></div>
        </header>

        <main className="flex-1 overflow-auto">
        <ErrorBoundary>
        <Suspense fallback={<div className="p-8 text-sm text-slate-400">Loading…</div>}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/devices" element={<Devices me={me} />} />
          <Route path="/devices/:id" element={<DeviceDetail me={me} />} />
          <Route path="/templates" element={<Templates me={me} />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/alerts" element={<Alerts me={me} />} />
          <Route path="/topology" element={<Topology me={me} />} />
          <Route path="/rack" element={<Rack />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/traffic" element={<Traffic me={me} />} />
          <Route path="/clients" element={<Clients />} />
          {/* Locate was folded into the Clients search; keep the old path working */}
          <Route path="/locate" element={<Navigate to="/clients" replace />} />
          {/* PoE is now a tab inside Analytics; keep the old path working */}
          <Route path="/poe" element={<Navigate to="/analytics" replace />} />
          <Route path="/lifecycle" element={<Lifecycle me={me} />} />
          <Route path="/firmware" element={<Firmware me={me} />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/sites" element={<Sites me={me} />} />
          <Route path="/compliance" element={<Compliance me={me} />} />
          <Route path="/maintenance" element={<Maintenance />} />
          <Route path="/discovery" element={<Discovery me={me} />} />
          {roleRank(me.role) >= roleRank('netadmin') && <Route path="/integrations" element={<Integrations />} />}
          {me.role === 'superadmin' && <Route path="/users" element={<Users />} />}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
        </Suspense>
        </ErrorBoundary>
        </main>
      </div>
    </div>
    </SiteScopeProvider>
  );
}
