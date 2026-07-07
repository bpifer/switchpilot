import { useApiQuery } from '../../hooks/useApiQuery';
import { Card } from '../../components/ui';

const VLAN_PALETTE = [
  '#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6',
  '#06b6d4','#f97316','#84cc16','#ec4899','#6366f1',
  '#14b8a6','#a855f7','#eab308','#f43f5e','#0ea5e9',
];

export default function VlansTab({ deviceId }: { deviceId: string }) {
  const { data } = useApiQuery<{ vlans: any[]; trunkPorts: string[] }>(`/api/analytics/device/${deviceId}/vlans`);

  if (!data) return <div className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">Loading VLAN data…</div>;

  const { vlans, trunkPorts } = data;

  if (vlans.length === 0 && trunkPorts.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-slate-400 dark:text-slate-500">
        No VLAN data yet - collected on the next device refresh.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {trunkPorts.length > 0 && (
        <Card title="Trunk ports">
          <div className="flex flex-wrap gap-2">
            {trunkPorts.map(p => (
              <span key={p}
                className="rounded-md bg-slate-100 px-2.5 py-1 font-mono text-xs font-medium text-slate-700 ring-1 ring-slate-200 dark:bg-slate-700/50 dark:text-slate-300 dark:ring-slate-700">
                {p}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
            Trunk ports carry all allowed VLANs - see your running config for allowed VLAN list.
          </p>
        </Card>
      )}

      <Card title="VLAN membership">
        <div className="space-y-3">
          {vlans.map((v, idx) => {
            const color = VLAN_PALETTE[idx % VLAN_PALETTE.length];
            const ports: string[] = v.ports ?? [];
            return (
              <div key={v.id} className="flex items-start gap-3 rounded-lg border border-slate-100 p-3 dark:border-slate-800">
                <div
                  className="mt-0.5 h-5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">VLAN {v.id}</span>
                    {v.name && v.name !== `VLAN${v.id}` && (
                      <span className="text-sm text-slate-500 dark:text-slate-400">{v.name}</span>
                    )}
                    <span className="ml-auto text-xs text-slate-400 dark:text-slate-500">
                      {ports.length} port{ports.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {ports.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {ports.map(p => (
                        <span key={p}
                          className="rounded px-1.5 py-0.5 font-mono text-xs ring-1"
                          style={{
                            backgroundColor: color + '18',
                            color,
                            border: `1px solid ${color}40`,
                          }}>
                          {p}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400 dark:text-slate-500">No access ports</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
