import { useApiQuery } from '../../hooks/useApiQuery';
import { Card } from '../../components/ui';

interface TimelineEvent {
  ts: string;
  kind: 'config' | 'audit' | 'alert' | 'job';
  title: string;
  by?: string;
  severity?: string;
  meta?: string;
}

const KIND: Record<string, { dot: string; label: string }> = {
  config: { dot: 'bg-blue-500', label: 'config' },
  audit: { dot: 'bg-slate-400', label: 'action' },
  alert: { dot: 'bg-amber-500', label: 'alert' },
  job: { dot: 'bg-emerald-500', label: 'job' },
};

// One chronological feed per device: config-history commits, audited actions,
// alerts, and job results merged server-side from data that already exists.
export default function TimelineTab({ deviceId }: { deviceId: string }) {
  const { data: events = [], isLoading } = useApiQuery<TimelineEvent[]>(
    `/api/devices/${deviceId}/timeline`, { refetchInterval: 60000 });

  return (
    <Card title="Activity timeline">
      {isLoading ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">Loading…</p>
      ) : events.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">
          No recorded activity yet. Config changes, alerts, jobs, and audited actions appear here.
        </p>
      ) : (
        <ol className="relative space-y-3 border-l border-slate-200 pl-5 dark:border-slate-700">
          {events.map((e, i) => {
            const s = KIND[e.kind] ?? KIND.audit;
            const dot = e.kind === 'alert' && e.severity === 'critical' ? 'bg-red-500' : s.dot;
            const metaTone = e.meta === 'failed' || e.meta === 'open' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500';
            return (
              <li key={i} className="relative">
                <span className={`absolute -left-[1.42rem] top-1.5 h-2 w-2 rounded-full ring-2 ring-white dark:ring-slate-900 ${dot}`} />
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{s.label}</span>{' '}
                    <span className="text-sm text-slate-700 dark:text-slate-300">{e.title}</span>
                    {e.meta && <span className={`ml-2 text-xs ${metaTone}`}>{e.meta}</span>}
                    {e.by && <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">by {e.by}</span>}
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-slate-400 dark:text-slate-500">{new Date(e.ts).toLocaleString()}</span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
