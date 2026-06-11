import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { PageHeader, Card, StatusBadge } from '../components/ui';

export default function Dashboard() {
  const [summary, setSummary] = useState<any>(null);
  const [alerts, setAlerts] = useState<any[]>([]);

  useEffect(() => {
    api('/api/summary').then(setSummary).catch(() => {});
    api('/api/alerts?limit=10').then(setAlerts).catch(() => {});
    const t = setInterval(() => {
      api('/api/summary').then(setSummary).catch(() => {});
      api('/api/alerts?limit=10').then(setAlerts).catch(() => {});
    }, 30000);
    return () => clearInterval(t);
  }, []);

  const dev = summary?.devices ?? {};
  const al = summary?.openAlerts ?? {};

  return (
    <div>
      <PageHeader title="Dashboard" />
      <div className="grid grid-cols-2 gap-4 p-6 lg:grid-cols-4">
        <Stat label="Devices online" value={dev.online ?? 0} tone="text-green-600" />
        <Stat label="Devices offline" value={dev.offline ?? 0} tone={dev.offline ? 'text-red-600' : 'text-gray-400'} />
        <Stat label="Critical alerts" value={al.critical ?? 0} tone={al.critical ? 'text-red-600' : 'text-gray-400'} />
        <Stat label="Warnings" value={al.warning ?? 0} tone={al.warning ? 'text-yellow-600' : 'text-gray-400'} />
      </div>
      <div className="px-6 pb-6">
        <Card title="Recent alerts">
          {alerts.length === 0 && <div className="text-sm text-gray-400">No open alerts 🎉</div>}
          <ul className="divide-y">
            {alerts.map(a => (
              <li key={a.id} className="flex items-center gap-3 py-2 text-sm">
                <StatusBadge status={a.severity} />
                <span className="font-medium">{a.hostname ?? 'platform'}</span>
                <span className="flex-1 text-gray-600">{a.message}</span>
                <span className="text-xs text-gray-400">{new Date(a.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 text-right">
            <Link to="/alerts" className="text-sm text-brand-600 hover:underline">View all alerts →</Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border bg-white p-5 shadow-sm">
      <div className={`text-3xl font-bold ${tone}`}>{value}</div>
      <div className="mt-1 text-sm text-gray-500">{label}</div>
    </div>
  );
}
