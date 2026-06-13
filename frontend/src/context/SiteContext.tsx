// Global site scope (Meraki-style): '' = all sites, 'unassigned' = devices
// without a site, otherwise a site UUID. Persisted across sessions.
import { createContext, useContext, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'sp_site';

interface SiteScope {
  siteId: string;
  setSiteId: (id: string) => void;
}

const Ctx = createContext<SiteScope>({ siteId: '', setSiteId: () => {} });

export function SiteScopeProvider({ children }: { children: ReactNode }) {
  const [siteId, setSiteIdState] = useState(() => localStorage.getItem(STORAGE_KEY) ?? '');
  const setSiteId = (id: string) => {
    setSiteIdState(id);
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  };
  return <Ctx.Provider value={{ siteId, setSiteId }}>{children}</Ctx.Provider>;
}

export function useSiteScope(): SiteScope {
  return useContext(Ctx);
}

/** Append the siteId param to an API path, handling existing query strings. */
export function scoped(path: string, siteId: string): string {
  if (!siteId) return path;
  return `${path}${path.includes('?') ? '&' : '?'}siteId=${encodeURIComponent(siteId)}`;
}
