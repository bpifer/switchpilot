import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApiQuery } from '../hooks/useApiQuery';
import { PageHeader, Card, Button } from '../components/ui';
import { useSiteScope, scoped } from '../context/SiteContext';

interface Node { id: string; label: string; model: string; status: string; managed: boolean; ip: string; stackSize: number; orphan?: boolean; }
interface Edge { source: string; target: string; sourcePort: string; targetPort: string; protocol: string; }
type Pos = { x: number; y: number };

const CANVAS = { cx: 520, cy: 340 };

// Stable default so a loading/empty response doesn't hand a fresh {nodes:[]}
// object to the position-seeding effect every render (which looped it forever).
const EMPTY_GRAPH: { nodes: Node[]; edges: Edge[] } = { nodes: [], edges: [] };

export default function Topology() {
  const { siteId } = useSiteScope();
  const { data: graph = EMPTY_GRAPH } =
    useApiQuery<{ nodes: Node[]; edges: Edge[] }>(scoped('/api/topology', siteId), { refetchInterval: 60000 });
  const navigate = useNavigate();
  const svgRef = useRef<SVGSVGElement>(null);

  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [pos, setPos] = useState<Map<string, Pos>>(new Map());
  const [hover, setHover] = useState<string | null>(null);
  // drag state kept in a ref so pointer moves don't thrash React state
  const drag = useRef<{ mode: 'pan' | 'node'; id?: string; sx: number; sy: number; ox: number; oy: number } | null>(null);

  // Seed positions for any nodes we haven't placed yet (radial: managed inner,
  // neighbors outer). Existing positions are preserved across refetches/drags.
  useEffect(() => {
    setPos(prev => {
      const next = new Map(prev);
      const managed = graph.nodes.filter(n => n.managed);
      const external = graph.nodes.filter(n => !n.managed);
      managed.forEach((n, i) => {
        if (next.has(n.id)) return;
        const a = (2 * Math.PI * i) / Math.max(managed.length, 1) - Math.PI / 2;
        const r = managed.length === 1 ? 0 : 170;
        next.set(n.id, { x: CANVAS.cx + r * Math.cos(a), y: CANVAS.cy + r * Math.sin(a) });
      });
      external.forEach((n, i) => {
        if (next.has(n.id)) return;
        const a = (2 * Math.PI * i) / Math.max(external.length, 1) - Math.PI / 2 + 0.3;
        next.set(n.id, { x: CANVAS.cx + 290 * Math.cos(a), y: CANVAS.cy + 290 * Math.sin(a) });
      });
      return next;
    });
  }, [graph.nodes]);

  const rel = (e: React.PointerEvent | React.WheelEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };
  const toWorld = (sx: number, sy: number) => ({ x: (sx - view.x) / view.k, y: (sy - view.y) / view.k });

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const { sx, sy } = rel(e);
    drag.current = { mode: 'pan', sx, sy, ox: view.x, oy: view.y };
  }
  function onNodeDown(e: React.PointerEvent, id: string) {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const { sx, sy } = rel(e);
    const p = pos.get(id)!;
    drag.current = { mode: 'node', id, sx, sy, ox: p.x, oy: p.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const { sx, sy } = rel(e);
    if (d.mode === 'pan') {
      setView(v => ({ ...v, x: d.ox + (sx - d.sx), y: d.oy + (sy - d.sy) }));
    } else if (d.id) {
      const nx = d.ox + (sx - d.sx) / view.k;
      const ny = d.oy + (sy - d.sy) / view.k;
      setPos(prev => new Map(prev).set(d.id!, { x: nx, y: ny }));
    }
  }
  const onPointerUp = () => { drag.current = null; };

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const { sx, sy } = rel(e);
    const w = toWorld(sx, sy);
    const k = Math.min(3, Math.max(0.3, view.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    setView({ k, x: sx - w.x * k, y: sy - w.y * k });
  }

  const zoom = (factor: number) =>
    setView(v => {
      const k = Math.min(3, Math.max(0.3, v.k * factor));
      // zoom around canvas centre
      const w = { x: (CANVAS.cx - v.x) / v.k, y: (CANVAS.cy - v.y) / v.k };
      return { k, x: CANVAS.cx - w.x * k, y: CANVAS.cy - w.y * k };
    });
  const reset = () => setView({ x: 0, y: 0, k: 1 });

  const nodeFill = (n: Node) =>
    !n.managed ? '#94a3b8' : n.status === 'online' ? '#16a34a' : n.status === 'offline' ? '#dc2626' : '#9ca3af';
  const hoverNode = graph.nodes.find(n => n.id === hover);
  const hoverPos = hover ? pos.get(hover) : null;
  const orphans = graph.nodes.filter(n => n.managed && n.orphan).length;

  return (
    <div>
      <PageHeader title="Network topology">
        <Button variant="secondary" onClick={() => zoom(1.2)}>+</Button>
        <Button variant="secondary" onClick={() => zoom(1 / 1.2)}>−</Button>
        <Button variant="secondary" onClick={reset}>Reset</Button>
      </PageHeader>
      <div className="p-6">
        <Card title={`Layer-2 map — ${graph.nodes.length} nodes, ${graph.edges.length} links (CDP/LLDP)${orphans ? `, ${orphans} with no neighbors` : ''}. Drag to pan, scroll to zoom, drag a node to move it.`}>
          <div className="relative">
            <svg
              ref={svgRef}
              className="h-[70vh] w-full touch-none select-none rounded bg-slate-50"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
              onWheel={onWheel}
            >
              <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
                {graph.edges.map((e, i) => {
                  const a = pos.get(e.source), b = pos.get(e.target);
                  if (!a || !b) return null;
                  const hl = hover === e.source || hover === e.target;
                  return (
                    <g key={i}>
                      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                            stroke={hl ? '#0d7a5f' : '#cbd5e1'} strokeWidth={hl ? 2 : 1.25}
                            vectorEffect="non-scaling-stroke" />
                      {hl && (
                        <>
                          <text x={(a.x * 2 + b.x) / 3} y={(a.y * 2 + b.y) / 3 - 3} fontSize="9" fill="#475569" textAnchor="middle">{e.sourcePort}</text>
                          <text x={(a.x + b.x * 2) / 3} y={(a.y + b.y * 2) / 3 - 3} fontSize="9" fill="#475569" textAnchor="middle">{e.targetPort}</text>
                        </>
                      )}
                    </g>
                  );
                })}
                {graph.nodes.map(n => {
                  const p = pos.get(n.id);
                  if (!p) return null;
                  return (
                    <g key={n.id}
                       onPointerDown={e => onNodeDown(e, n.id)}
                       onMouseEnter={() => setHover(n.id)}
                       onMouseLeave={() => setHover(null)}
                       onDoubleClick={() => n.managed && navigate(`/devices/${n.id}`)}
                       className="cursor-pointer">
                      {n.managed
                        ? <rect x={p.x - 17} y={p.y - 12} width="34" height="24" rx="5" fill={nodeFill(n)}
                                stroke={hover === n.id ? '#0d7a5f' : n.orphan ? '#f59e0b' : 'transparent'} strokeWidth="2"
                                strokeDasharray={n.orphan && hover !== n.id ? '3 2' : undefined} />
                        : <circle cx={p.x} cy={p.y} r="10" fill={nodeFill(n)}
                                  stroke={hover === n.id ? '#0d7a5f' : 'transparent'} strokeWidth="2" />}
                      {n.stackSize > 1 && <text x={p.x} y={p.y + 4} fontSize="9" fill="white" textAnchor="middle">×{n.stackSize}</text>}
                      <text x={p.x} y={p.y + 27} fontSize="11" fontWeight="600" fill="#1f2937" textAnchor="middle">{n.label}</text>
                    </g>
                  );
                })}
              </g>
              {graph.nodes.length === 0 && (
                <text x="50%" y="50%" textAnchor="middle" fill="#9ca3af" fontSize="14">
                  No topology yet — add devices and wait for the first CDP/LLDP poll.
                </text>
              )}
            </svg>

            {/* hover detail card, positioned at the node's screen coords */}
            {hoverNode && hoverPos && (
              <div className="pointer-events-none absolute z-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
                   style={{ left: view.x + hoverPos.x * view.k + 14, top: view.y + hoverPos.y * view.k - 10 }}>
                <div className="font-medium text-slate-800">{hoverNode.label}</div>
                <div className="mt-0.5 text-slate-500">{hoverNode.model || (hoverNode.managed ? 'managed' : 'neighbor')}</div>
                {hoverNode.ip && <div className="font-mono text-slate-400">{hoverNode.ip}</div>}
                <div className="mt-0.5">
                  <span className={hoverNode.status === 'online' ? 'text-green-600' : hoverNode.status === 'offline' ? 'text-red-600' : 'text-slate-400'}>
                    {hoverNode.managed ? hoverNode.status : 'unmanaged neighbor'}
                  </span>
                </div>
                {hoverNode.managed && <div className="mt-1 text-brand-600">double-click to open</div>}
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
              <Legend color="#16a34a" label="Online (managed)" />
              <Legend color="#dc2626" label="Offline" />
              <Legend color="#94a3b8" label="Neighbor (unmanaged)" round />
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-4 rounded-sm border-2 border-dashed border-amber-500" />
                No neighbors (orphan)
              </span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Legend({ color, label, round = false }: { color: string; label: string; round?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-3 w-4 ${round ? 'rounded-full' : 'rounded-sm'}`} style={{ background: color }} />
      {label}
    </span>
  );
}
