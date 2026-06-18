import { Link } from 'react-router-dom';
import { useApiQuery } from '../hooks/useApiQuery';
import { PageHeader, Card, StatusBadge, Icon } from '../components/ui';
import { useSiteScope, scoped } from '../context/SiteContext';

const STAT_ICONS = {
  online:   { d: 'M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z', bg: 'bg-green-50',  icon: 'text-green-600' },
  offline:  { d: 'M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z', bg: 'bg-red-50', icon: 'text-red-500' },
  critical: { d: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z', bg: 'bg-red-50', icon: 'text-red-500' },
  warning:  { d: 'M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z', bg: 'bg-amber-50', icon: 'text-amber-500' },
};

export default function Dashboard() {
  const { siteId } = useSiteScope();
  const { data: summary } = useApiQuery<any>(scoped('/api/summary', siteId), { refetchInterval: 30000 });
  const { data: alerts = [] } = useApiQuery<any[]>(scoped('/api/alerts?limit=10', siteId), { refetchInterval: 30000 });

  const dev = summary?.devices ?? {};
  const al  = summary?.openAlerts ?? {};
  const health = summary?.health;

  return (
    <div>
      <PageHeader title="Dashboard" />

      {health && <HealthBanner health={health} />}

      <div className="grid grid-cols-2 gap-4 px-6 pb-2 pt-4 lg:grid-cols-4">
        <StatCard label="Devices online"  value={dev.online ?? 0}  valueClass="text-green-600"  meta={STAT_ICONS.online} />
        <StatCard label="Devices offline" value={dev.offline ?? 0} valueClass={dev.offline ? 'text-red-600' : 'text-slate-400'} meta={STAT_ICONS.offline} />
        <StatCard label="Critical alerts" value={al.critical ?? 0} valueClass={al.critical ? 'text-red-600' : 'text-slate-400'} meta={STAT_ICONS.critical} />
        <StatCard label="Warnings"        value={al.warning ?? 0}  valueClass={al.warning ? 'text-amber-600' : 'text-slate-400'} meta={STAT_ICONS.warning} />
      </div>

      <div className="px-6 pb-6">
        <Card title="Recent alerts">
          {alerts.length === 0 ? (
            <div className="flex flex-col items-center py-6 text-slate-400">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5}
                   stroke="currentColor" className="mb-2 h-8 w-8 text-slate-300">
                <path strokeLinecap="round" strokeLinejoin="round"
                      d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm">All clear — no open alerts</span>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {alerts.map(a => (
                <li key={a.id} className="flex items-center gap-3 py-3 text-sm">
                  <StatusBadge status={a.severity} />
                  <span className="font-medium text-slate-700">{a.hostname ?? 'platform'}</span>
                  <span className="flex-1 truncate text-slate-500">{a.message}</span>
                  <span className="shrink-0 text-xs text-slate-400">
                    {new Date(a.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 border-t border-slate-100 pt-3 text-right">
            <Link to="/alerts" className="text-sm font-medium text-brand-600 hover:text-brand-700 hover:underline">
              View all alerts →
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

interface FleetHealth {
  score: number;
  grade: string;
  components: { onlinePct: number; compliancePct: number; openCriticals: number; criticalPenalty: number };
}

function HealthBanner({ health }: { health: FleetHealth }) {
  const { score, grade, components: c } = health;
  const tone = score >= 80 ? { ring: 'ring-green-200', bar: 'bg-green-500', text: 'text-green-700' }
    : score >= 60 ? { ring: 'ring-amber-200', bar: 'bg-amber-500', text: 'text-amber-700' }
    : { ring: 'ring-red-200', bar: 'bg-red-500', text: 'text-red-700' };
  return (
    <div className="px-6 pt-6">
      <div className={`flex flex-wrap items-center gap-x-8 gap-y-4 rounded-xl bg-white p-5 shadow-sm ring-1 ${tone.ring}`}>
        <div className="flex items-baseline gap-2">
          <span className={`text-4xl font-bold ${tone.text}`}>{score}</span>
          <span className="text-sm text-slate-400">/100</span>
          <span className={`ml-1 text-2xl font-bold ${tone.text}`}>{grade}</span>
        </div>
        <div className="min-w-[10rem] flex-1">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Fleet health</div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full ${tone.bar}`} style={{ width: `${score}%` }} />
          </div>
        </div>
        <div className="flex gap-8">
          <HealthComponent label="Reachable" value={`${c.onlinePct}%`} />
          <HealthComponent label="Compliant" value={`${c.compliancePct}%`} />
          <HealthComponent label="Open criticals" value={String(c.openCriticals)} warn={c.openCriticals > 0} />
        </div>
      </div>
    </div>
  );
}

function HealthComponent({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold ${warn ? 'text-red-600' : 'text-slate-700'}`}>{value}</div>
    </div>
  );
}

function StatCard({
  label, value, valueClass, meta,
}: {
  label: string;
  value: number;
  valueClass: string;
  meta: { d: string; bg: string; icon: string };
}) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <p className={`mt-1.5 text-3xl font-bold ${valueClass}`}>{value}</p>
      </div>
      <div className={`rounded-xl p-2.5 ${meta.bg}`}>
        <Icon d={meta.d} className={`h-5 w-5 ${meta.icon}`} />
      </div>
    </div>
  );
}
