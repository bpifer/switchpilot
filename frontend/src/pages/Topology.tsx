import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { PageHeader, Card } from '../components/ui';

interface Node { id: string; label: string; model: string; status: string; managed: boolean; ip: string; stackSize: number; }
interface Edge { source: string; target: string; sourcePort: string; targetPort: string; protocol: string; }

/**
 * Simple force-free radial layout: managed devices on an inner ring,
 * unmanaged neighbors on an outer ring, links drawn as SVG lines.
 */
export default function Topology() {
  const [graph, setGraph] = useState<{ nodes: Node[]; edges: Edge[] }>({ nodes: [], edges: [] });
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    api('/api/topology').then(setGraph).catch(() => {});
    const t = setInterval(() => api('/api/topology').then(setGraph).catch(() => {}), 60000);
    return () => clearInterval(t);
  }, []);

  const W = 1000, H = 640, CX = W / 2, CY = H / 2;
  const positions = useMemo(() => {
    const pos = new Map<string, { x: number; y: number }>();
    const managed = graph.nodes.filter(n => n.managed);
    const external = graph.nodes.filter(n => !n.managed);
    managed.forEach((n, i) => {
      const a = (2 * Math.PI * i) / Math.max(managed.length, 1) - Math.PI / 2;
      const r = managed.length === 1 ? 0 : 170;
      pos.set(n.id, { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) });
    });
    external.forEach((n, i) => {
      const a = (2 * Math.PI * i) / Math.max(external.length, 1) - Math.PI / 2 + 0.3;
      pos.set(n.id, { x: CX + 280 * Math.cos(a), y: CY + 280 * Math.sin(a) });
    });
    return pos;
  }, [graph]);

  return (
    <div>
      <PageHeader title="Network topology" />
      <div className="p-6">
        <Card title={`Layer-2 map — ${graph.nodes.length} nodes, ${graph.edges.length} links (CDP/LLDP, auto-updating)`}>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded bg-gray-50">
            {graph.edges.map((e, i) => {
              const a = positions.get(e.source), b = positions.get(e.target);
              if (!a || !b) return null;
              const highlight = hover === e.source || hover === e.target;
              return (
                <g key={i}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                        stroke={highlight ? '#0d7a5f' : '#cbd5e1'} strokeWidth={highlight ? 2.5 : 1.5} />
                  {highlight && (
                    <>
                      <text x={(a.x * 2 + b.x) / 3} y={(a.y * 2 + b.y) / 3 - 4} fontSize="10" fill="#475569">{e.sourcePort}</text>
                      <text x={(a.x + b.x * 2) / 3} y={(a.y + b.y * 2) / 3 - 4} fontSize="10" fill="#475569">{e.targetPort}</text>
                    </>
                  )}
                </g>
              );
            })}
            {graph.nodes.map(n => {
              const p = positions.get(n.id);
              if (!p) return null;
              const fill = !n.managed ? '#94a3b8' : n.status === 'online' ? '#16a34a' : n.status === 'offline' ? '#dc2626' : '#9ca3af';
              return (
                <g key={n.id} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} className="cursor-pointer">
                  {n.managed ? (
                    <Link to={`/devices/${n.id}`}>
                      <rect x={p.x - 16} y={p.y - 11} width="32" height="22" rx="4" fill={fill} />
                    </Link>
                  ) : (
                    <circle cx={p.x} cy={p.y} r="10" fill={fill} />
                  )}
                  {n.stackSize > 1 && <text x={p.x} y={p.y + 4} fontSize="9" fill="white" textAnchor="middle">×{n.stackSize}</text>}
                  <text x={p.x} y={p.y + 26} fontSize="11" fontWeight="600" fill="#1f2937" textAnchor="middle">{n.label}</text>
                  <text x={p.x} y={p.y + 38} fontSize="9" fill="#6b7280" textAnchor="middle">{n.model || n.ip}</text>
                </g>
              );
            })}
            {graph.nodes.length === 0 && (
              <text x={CX} y={CY} textAnchor="middle" fill="#9ca3af" fontSize="14">
                No topology yet — add devices and wait for the first CDP/LLDP poll.
              </text>
            )}
          </svg>
        </Card>
      </div>
    </div>
  );
}
