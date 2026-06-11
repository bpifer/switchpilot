// Meraki-style graphical switch front panel.
// Ports render as a two-row grid (odd top, even bottom) per module, colored by state.
export interface Port {
  name: string;
  description: string;
  admin_up: boolean;
  oper_status: string;
  vlan: string;
  mode: string;
  speed: string;
  duplex: string;
  poe_watts: number | null;
  input_errors: number;
  output_errors: number;
  macs: string[];
  flap_count_1h: number;
}

function portColor(p: Port): string {
  if (!p.admin_up || p.oper_status === 'disabled') return 'bg-gray-300 border-gray-400';
  if (p.oper_status === 'err-disabled') return 'bg-red-500 border-red-700';
  if (p.oper_status === 'connected') {
    if (p.input_errors > 0 || p.output_errors > 0) return 'bg-yellow-400 border-yellow-600';
    return 'bg-green-500 border-green-700';
  }
  return 'bg-white border-gray-300';
}

export default function PortGrid({ ports, selected, onSelect }: {
  ports: Port[];
  selected: string | null;
  onSelect: (name: string) => void;
}) {
  // group by module prefix, e.g. "Gi1/0" for Gi1/0/24 — keeps stack members separate
  const groups = new Map<string, Port[]>();
  for (const p of ports) {
    if (p.name.startsWith('Po') || p.name.startsWith('Ap')) continue; // skip port-channels/AP mgr
    const idx = p.name.lastIndexOf('/');
    const key = idx > 0 ? p.name.slice(0, idx) : p.name.replace(/\d+$/, '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }

  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([module, list]) => {
        const sorted = [...list].sort((a, b) => portNum(a.name) - portNum(b.name));
        const odd = sorted.filter(p => portNum(p.name) % 2 === 1);
        const even = sorted.filter(p => portNum(p.name) % 2 === 0);
        return (
          <div key={module}>
            <div className="mb-1 text-xs font-medium text-gray-500">{module}/x</div>
            <div className="inline-block rounded-lg border-2 border-gray-700 bg-gray-800 p-3">
              {[odd, even].map((row, i) => (
                <div key={i} className="flex gap-1.5 first:mb-1.5">
                  {row.map(p => (
                    <button
                      key={p.name}
                      title={`${p.name} — ${p.oper_status}${p.description ? ` — ${p.description}` : ''}${p.poe_watts ? ` — ${p.poe_watts}W PoE` : ''}`}
                      onClick={() => onSelect(p.name)}
                      className={`h-6 w-7 rounded-sm border-2 text-[8px] leading-none text-gray-800
                        ${portColor(p)} ${selected === p.name ? 'ring-2 ring-sky-400' : ''}
                        ${p.poe_watts ? 'shadow-[inset_0_-3px_0_rgba(37,99,235,0.9)]' : ''}`}
                    >
                      {portNum(p.name)}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-4 text-xs text-gray-500">
        <Legend cls="bg-green-500" label="Connected" />
        <Legend cls="bg-white border border-gray-300" label="Not connected" />
        <Legend cls="bg-gray-300" label="Disabled" />
        <Legend cls="bg-red-500" label="Err-disabled" />
        <Legend cls="bg-yellow-400" label="Errors" />
        <Legend cls="bg-green-500 shadow-[inset_0_-3px_0_rgba(37,99,235,0.9)]" label="PoE active" />
      </div>
    </div>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return <span className="flex items-center gap-1.5"><span className={`inline-block h-3 w-4 rounded-sm ${cls}`} />{label}</span>;
}

function portNum(name: string): number {
  return parseInt(name.match(/(\d+)$/)?.[1] ?? '0', 10);
}
