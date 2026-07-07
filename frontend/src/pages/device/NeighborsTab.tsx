import { useApiQuery } from '../../hooks/useApiQuery';
import { Card } from '../../components/ui';

export default function NeighborsTab({ deviceId }: { deviceId: string }) {
  const { data: neighbors = [] } = useApiQuery<any[]>(`/api/devices/${deviceId}/neighbors`);
  return (
    <Card title="CDP / LLDP neighbors">
      <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left text-xs uppercase text-gray-500 dark:text-slate-400">
          <th className="py-1">Local port</th><th>Neighbor</th><th>Neighbor port</th><th>IP</th><th>Platform</th><th>Via</th></tr></thead>
        <tbody>
          {neighbors.map(n => (
            <tr key={n.id} className="border-b last:border-0">
              <td className="py-1.5 font-mono text-xs">{n.local_port}</td>
              <td>{n.neighbor_name}</td>
              <td className="font-mono text-xs">{n.neighbor_port}</td>
              <td className="font-mono text-xs">{n.neighbor_ip}</td>
              <td>{n.neighbor_platform}</td>
              <td className="uppercase text-xs text-gray-500 dark:text-slate-400">{n.protocol}</td>
            </tr>
          ))}
          {neighbors.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-gray-400 dark:text-slate-500">No neighbors discovered yet</td></tr>}
        </tbody>
      </table>
      </div>
    </Card>
  );
}
