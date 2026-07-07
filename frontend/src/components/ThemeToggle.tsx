import { useTheme, setTheme } from '../hooks/useTheme';

const SUN = 'M12 3v1.5m6.364 1.136-1.06 1.06M21 12h-1.5m-1.136 6.364-1.06-1.06M12 19.5V21m-6.364-1.136 1.06-1.06M3 12h1.5m1.136-6.364 1.06 1.06M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z';
const MOON = 'M21.752 15.002A9.72 9.72 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z';

/** Sidebar-footer light/dark switch. A single instance's state is shared
 *  live with any other mounted instance (mobile drawer + desktop rail) via
 *  the 'sp:theme' event useTheme listens for. */
export default function ThemeToggle() {
  const theme = useTheme();
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-slate-400 transition hover:bg-white/5 hover:text-slate-200"
    >
      <span className="flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4">
          <path strokeLinecap="round" strokeLinejoin="round" d={dark ? MOON : SUN} />
        </svg>
        {dark ? 'Dark mode' : 'Light mode'}
      </span>
      <span
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors motion-reduce:transition-none ${dark ? 'bg-brand-600' : 'bg-slate-600'}`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 translate-x-0.5 transform rounded-full bg-white transition motion-reduce:transition-none ${dark ? 'translate-x-4' : ''}`}
        />
      </span>
    </button>
  );
}
