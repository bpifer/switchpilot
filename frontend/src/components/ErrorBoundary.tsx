import { Component, type ReactNode } from 'react';

interface State { error: Error | null }

// A lazy chunk failing to load almost always means a new build was deployed
// while this tab held the old app shell - the chunk filenames no longer exist.
// A one-time reload pulls the fresh index.html and fixes it.
const CHUNK_ERROR = /dynamically imported module|Importing a module script failed|Failed to fetch.*\.js/i;

/** Catches render-time crashes so one broken page doesn't blank the whole app. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('render error:', error, info.componentStack);
    // Auto-recover from a stale-deploy chunk mismatch, but only once per ~10s
    // so a genuinely missing/broken chunk can't trigger a reload loop.
    if (CHUNK_ERROR.test(error.message)) {
      const last = Number(sessionStorage.getItem('sp_chunk_reload') || 0);
      if (Date.now() - last > 10_000) {
        sessionStorage.setItem('sp_chunk_reload', String(Date.now()));
        window.location.reload();
      }
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    const isChunk = CHUNK_ERROR.test(this.state.error.message);
    return (
      <div className="flex h-full items-center justify-center p-10">
        <div className="max-w-lg rounded-xl border border-red-200 bg-red-50 p-6 dark:bg-red-500/10">
          <h2 className="text-base font-semibold text-red-800 dark:text-red-400">
            {isChunk ? 'A newer version was deployed' : 'Something went wrong rendering this page'}
          </h2>
          {isChunk && (
            <p className="mt-2 text-sm text-red-700 dark:text-red-400">Reload to load the latest app.</p>
          )}
          <pre className="mt-3 max-h-40 overflow-auto rounded bg-white p-3 text-xs text-red-700 ring-1 ring-red-100 dark:bg-slate-800 dark:text-red-400 dark:ring-red-500/20">
            {this.state.error.message}
          </pre>
          <div className="mt-4 flex gap-2">
            <button
              className="rounded-lg bg-red-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-red-700"
              onClick={() => isChunk ? window.location.reload() : this.setState({ error: null })}
            >
              {isChunk ? 'Reload' : 'Try again'}
            </button>
            <button
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-800/50"
              onClick={() => { window.location.href = '/'; }}
            >
              Back to dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }
}
