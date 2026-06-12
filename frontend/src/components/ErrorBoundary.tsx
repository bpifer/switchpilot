import { Component, type ReactNode } from 'react';

interface State { error: Error | null }

/** Catches render-time crashes so one broken page doesn't blank the whole app. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('render error:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center p-10">
        <div className="max-w-lg rounded-xl border border-red-200 bg-red-50 p-6">
          <h2 className="text-base font-semibold text-red-800">Something went wrong rendering this page</h2>
          <pre className="mt-3 max-h-40 overflow-auto rounded bg-white p-3 text-xs text-red-700 ring-1 ring-red-100">
            {this.state.error.message}
          </pre>
          <div className="mt-4 flex gap-2">
            <button
              className="rounded-lg bg-red-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-red-700"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
            <button
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
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
