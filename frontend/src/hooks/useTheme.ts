import { useEffect, useState } from 'react';

// Explicit two-state toggle (light/dark), defaulting to the OS preference on
// first visit; once the operator picks one it's remembered and wins over the
// OS setting from then on. The <html> class is also set synchronously by an
// inline script in index.html before React mounts, so there's no flash of
// the wrong theme - this module just keeps things in sync afterward.
const STORAGE_KEY = 'sp.theme';
const EVENT = 'sp:theme';
export type Theme = 'light' | 'dark';

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

export function getTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* private mode */ }
  return systemPrefersDark() ? 'dark' : 'light';
}

export function setTheme(theme: Theme): void {
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* private mode */ }
  document.documentElement.classList.toggle('dark', theme === 'dark');
  window.dispatchEvent(new CustomEvent(EVENT, { detail: theme }));
}

/** Current theme, updating when set from anywhere (any ThemeToggle instance,
 *  including the one in a closed sidebar drawer on mobile). */
export function useTheme(): Theme {
  const [theme, setThemeState] = useState<Theme>(getTheme);
  useEffect(() => {
    const onChange = (e: Event) => setThemeState((e as CustomEvent<Theme>).detail);
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);
  return theme;
}
