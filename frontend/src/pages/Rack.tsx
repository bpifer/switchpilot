import { Link } from 'react-router-dom';
import { useApiQuery } from '../hooks/useApiQuery';
import { useSiteScope, scoped } from '../context/SiteContext';
import { PageHeader, Card } from '../components/ui';

interface Dev {
  id: string; hostname: string; mgmt_ip: string; model: string;
  status: string; rack_name: string; rack_unit: number | null; rack_height: number;
}

const U_PX = 30;   // pixel height of one rack unit

export default function Rack() {
  const { siteId } = useSiteScope();
  const { data: devices = [] } = useApiQuery<Dev[]>(scoped('/api/devices', siteId), { refetchInterval: 60000 });

  const placed = devices.filter(d => d.rack_name && d.rack_unit);
  const unracked = devices.filter(d => !(d.rack_name && d.rack_unit));
  const racks = new Map<string, Dev[]>();
  for (const d of placed) { const a = racks.get(d.rack_name) ?? []; a.push(d); racks.set(d.rack_name, a); }
  const rackNames = [...racks.keys()].sort();

  return (
    <div>
      <PageHeader title="Racks" />
      <div className="p-6">
        {rackNames.length === 0 ? (
          <Card>
            <p className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">
              No devices placed in a rack yet. Open a device, click <span className="font-medium text-slate-600 dark:text-slate-400">Settings</span>,
              and set its rack name + U position.
            </p>
          </Card>
        ) : (
          <div className="flex flex-wrap items-start gap-8">
            {rackNames.map(name => <RackColumn key={name} name={name} devs={racks.get(name)!} />)}
          </div>
        )}

        {unracked.length > 0 && (
          <Card className="mt-6">
            <div className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">Unracked ({unracked.length})</div>
            <div className="flex flex-wrap gap-2">
              {unracked.map(d => (
                <Link key={d.id} to={`/devices/${d.id}`}
                      className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800/50">
                  {d.hostname || d.mgmt_ip}
                </Link>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function RackColumn({ name, devs }: { name: string; devs: Dev[] }) {
  const maxU = Math.max(12, ...devs.map(d => (d.rack_unit ?? 1) + d.rack_height - 1));
  const startAt = new Map<number, Dev>();
  const spanned = new Set<number>();
  for (const d of devs) {
    const base = d.rack_unit!;
    startAt.set(base, d);
    for (let u = base; u < base + d.rack_height; u++) spanned.add(u);
  }

  const rows: React.JSX.Element[] = [];
  for (let u = maxU; u >= 1; u--) {
    const d = startAt.get(u);
    if (d) {
      rows.push(
        <Link key={u} to={`/devices/${d.id}`} title={`${d.hostname} - U${u}`}
              style={{ height: d.rack_height * U_PX }}
              className="flex items-center gap-2 border-b border-slate-700/40 bg-slate-800 px-2 text-white hover:bg-slate-700">
          <span className={`h-2 w-2 shrink-0 rounded-full ${
            d.status === 'online' ? 'bg-green-500' : d.status === 'offline' ? 'bg-red-500' : 'bg-slate-400'}`} />
          <span className="truncate text-xs font-medium">{d.hostname || d.mgmt_ip}</span>
          <span className="ml-auto shrink-0 truncate text-[10px] text-slate-400 dark:text-slate-500">{d.model}</span>
        </Link>
      );
    } else if (!spanned.has(u)) {
      rows.push(
        <div key={u} style={{ height: U_PX }}
             className="flex items-center border-b border-slate-200 bg-slate-50 px-2 text-[10px] text-slate-300 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-600">
          {u}
        </div>
      );
    }
    // U's spanned by a multi-unit device above are covered by its box.
  }

  return (
    <div>
      <div className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">{name}</div>
      <div className="w-64 overflow-hidden rounded-lg border-2 border-slate-300 dark:border-slate-600">{rows}</div>
    </div>
  );
}
