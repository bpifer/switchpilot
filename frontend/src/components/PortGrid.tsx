// Switch front panel. Handles Cisco naming (Gi1/0/1, Te1/1/1) and MikroTik
// RouterOS naming (ether1, sfp-sfpplus1). Connected ports are colored by link
// speed: 10G blue, 1G green, 10/100 orange. vendor-neutral.
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

/** Normalize a speed string ("1000", "a-1000", "10G", "10Gbps", "100") to Mbps. */
function speedMbps(speed: string): number | null {
  const s = (speed || '').toLowerCase().replace(/[^0-9gm.]/g, '');
  const g = s.match(/([\d.]+)g/);            // "10g" -> 10000, "1g" -> 1000
  if (g) return Math.round(parseFloat(g[1]) * 1000);
  const m = s.match(/(\d+)/);
  return m ? Number(m[1]) : null;            // assume Mbps
}

function portColor(p: Port): string {
  if (!p.admin_up || p.oper_status === 'disabled') return 'bg-gray-300 border-gray-400';
  if (p.oper_status === 'err-disabled') return 'bg-red-500 border-red-700';
  if (p.oper_status === 'connected') {
    if ((p.input_errors ?? 0) > 0 || (p.output_errors ?? 0) > 0) return 'bg-yellow-400 border-yellow-600';
    const mbps = speedMbps(p.speed);
    if (mbps !== null && mbps >= 10000) return 'bg-blue-500 border-blue-700';   // 10G+
    if (mbps !== null && mbps < 1000)   return 'bg-orange-500 border-orange-600'; // 10/100
    return 'bg-green-500 border-green-700';                                       // 1G (or unknown)
  }
  return 'bg-white border-gray-300';
}

/** Trailing port number: Gi1/0/24 -> 24, ether24 -> 24, sfp-sfpplus2 -> 2. */
function portNum(name: string): number {
  const slash = name.lastIndexOf('/');
  const seg = slash >= 0 ? name.slice(slash + 1) : name.replace(/^\D+/, '');
  return parseInt(seg, 10) || 0;
}

/** Group key: Cisco module (Gi1/0) or RouterOS interface family (ether, sfp). */
function modKey(name: string): string {
  const slash = name.lastIndexOf('/');
  return slash >= 0 ? name.slice(0, slash) : name.replace(/\d+$/, '');
}

/** 10G+ copper uplinks (Cisco) and all SFP/SFP+ cages (Cisco + RouterOS). */
function isUplink(name: string): boolean {
  return /^(Te|Tw|Fo|Hu)/i.test(name) || /^(sfp|qsfp)/i.test(name);
}

export default function PortGrid({ ports, selected, onSelect }: {
  ports: Port[];
  selected: string | null;
  onSelect: (name: string) => void;
}) {
  // Real switchports only: Cisco slash names or RouterOS ether/sfp/combo, never
  // logical interfaces (port-channels, bridges, VLANs, management).
  const physical = ports.filter(p => {
    const n = p.name;
    if (/^(Po|Ap|Mg|bridge|vlan|lo|wlan|bond|pppoe|lag)/i.test(n)) return false;
    return n.includes('/') || /^(ether|sfp|qsfp|combo)/i.test(n);
  });

  const copper = physical.filter(p => !isUplink(p.name));
  const uplinks = physical.filter(p => isUplink(p.name));

  // Group access ports by module/family: Gi1/0, Fa0, ether, ...
  const groups = new Map<string, Port[]>();
  for (const p of copper) {
    const key = modKey(p.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }

  if (physical.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-gray-400">
        No port data yet - hit "Refresh now" to poll the switch.
      </div>
    );
  }

  const rangeLabel = (module: string, n: number) =>
    module.includes('/') ? `${module}/1–${n}` : `${module}1–${n}`;

  return (
    <div className="space-y-5">
      {[...groups.entries()].map(([module, list]) => {
        const sorted = [...list].sort((a, b) => portNum(a.name) - portNum(b.name));
        const odd  = sorted.filter(p => portNum(p.name) % 2 === 1);
        const even = sorted.filter(p => portNum(p.name) % 2 === 0);
        return (
          <div key={module}>
            <div className="mb-1 flex items-center gap-2">
              <span className="text-xs font-medium text-gray-500">{rangeLabel(module, sorted.length)}</span>
              <span className="text-xs text-gray-400">({sorted.filter(p => p.oper_status === 'connected').length} connected)</span>
            </div>
            <div className="inline-block rounded-lg border-2 border-gray-700 bg-gray-800 p-2.5">
              {[odd, even].map((row, i) => (
                <div key={i} className="flex gap-1 first:mb-1">
                  {row.map(p => (
                    <PortButton key={p.name} p={p} selected={selected} onSelect={onSelect} label={String(portNum(p.name))} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {uplinks.length > 0 && (
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500">Uplinks / SFP</span>
            <span className="text-xs text-gray-400">({uplinks.filter(p => p.oper_status === 'connected').length}/{uplinks.length} connected)</span>
          </div>
          <div className="inline-block rounded-lg border-2 border-gray-700 bg-gray-800 p-2.5">
            <div className="flex gap-1.5">
              {uplinks.sort((a, b) => portNum(a.name) - portNum(b.name)).map(p => (
                <PortButton key={p.name} p={p} selected={selected} onSelect={onSelect}
                  label={p.name.includes('/') ? p.name.replace(/^.*\//, '') : String(portNum(p.name))} wide />
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-4 text-xs text-gray-500">
        <Legend cls="bg-blue-500" label="10G+" />
        <Legend cls="bg-green-500" label="1 Gbps" />
        <Legend cls="bg-orange-500" label="10/100" />
        <Legend cls="bg-white border border-gray-300" label="Not connected" />
        <Legend cls="bg-gray-300" label="Disabled" />
        <Legend cls="bg-red-500" label="Err-disabled" />
        <Legend cls="bg-yellow-400" label="Errors" />
        <Legend cls="bg-green-500 shadow-[inset_0_-3px_0_rgba(37,99,235,0.9)]" label="PoE active" />
        <span className="flex items-center gap-1.5"><span className="text-sky-500">▲</span>Trunk / uplink</span>
      </div>
    </div>
  );
}

function PortButton({ p, selected, onSelect, label, wide = false }: {
  p: Port; selected: string | null; onSelect: (n: string) => void; label: string; wide?: boolean;
}) {
  const tooltip = [
    p.name,
    p.description || null,
    p.oper_status,
    p.vlan !== '1' ? `VLAN ${p.vlan}` : null,
    p.speed && p.speed !== 'auto' ? p.speed : null,
    p.poe_watts ? `${p.poe_watts}W PoE` : null,
    (p.macs ?? []).length > 0 ? `${p.macs.length} MAC${p.macs.length !== 1 ? 's' : ''}` : null,
  ].filter(Boolean).join(' — ');

  return (
    <button
      title={tooltip}
      onClick={() => onSelect(p.name)}
      className={`
        relative ${wide ? 'h-8 w-10' : 'h-6 w-7'} rounded-sm border-2 text-[8px] leading-none font-medium
        ${portColor(p)}
        ${selected === p.name ? 'ring-2 ring-sky-400 ring-offset-1 ring-offset-gray-800' : ''}
        ${p.poe_watts ? 'shadow-[inset_0_-3px_0_rgba(37,99,235,0.9)]' : ''}
        transition-opacity hover:opacity-80
      `}
    >
      {label}
      {p.mode === 'trunk' && (
        <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 text-[7px] leading-none text-sky-300"
              title="Trunk / uplink">▲</span>
      )}
    </button>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-3 w-4 rounded-sm border border-gray-400 ${cls}`} />
      {label}
    </span>
  );
}
