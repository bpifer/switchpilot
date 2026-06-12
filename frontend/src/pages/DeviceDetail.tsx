import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { useApiQuery } from '../hooks/useApiQuery';
import type { Me } from '../App';
import { PageHeader, Button, StatusBadge, fmtUptime } from '../components/ui';
import type { Port } from '../components/PortGrid';
import PortsTab from './device/PortsTab';
import ConfigTab from './device/ConfigTab';
import BackupsTab from './device/BackupsTab';
import HistoryTab from './device/HistoryTab';
import NeighborsTab from './device/NeighborsTab';
import VlansTab from './device/VlansTab';

export default function DeviceDetail({ me }: { me: Me }) {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<'ports' | 'config' | 'backups' | 'history' | 'neighbors' | 'vlans'>('ports');
  const [busy, setBusy] = useState(false);
  const canOperate = me.role !== 'readonly';
  const canConfig = me.role === 'superadmin' || me.role === 'netadmin';

  const { data: device, refetch: refetchDevice } = useApiQuery<any>(`/api/devices/${id}`, { refetchInterval: 60000 });
  const { data: ports = [], refetch: refetchPorts } = useApiQuery<Port[]>(`/api/devices/${id}/ports`, { refetchInterval: 60000 });
  const reload = () => { refetchDevice(); refetchPorts(); };

  async function refresh() {
    setBusy(true);
    try { await api(`/api/devices/${id}/refresh`, { method: 'POST' }); reload(); }
    catch (err: any) { alert(err.message); }
    finally { setBusy(false); }
  }

  if (!device) return <div className="p-6 text-gray-400">Loading…</div>;

  return (
    <div>
      <PageHeader title={device.hostname || device.mgmt_ip}>
        {canOperate && <Button variant="secondary" onClick={refresh} disabled={busy}>{busy ? 'Refreshing…' : '↻ Refresh now'}</Button>}
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 p-6 pb-0 md:grid-cols-4 lg:grid-cols-6">
        <Info label="Status"><StatusBadge status={device.status} /></Info>
        <Info label="Model">{device.model || '-'}</Info>
        <Info label="Serial">{device.serial_number || '-'}</Info>
        <Info label="IOS">{device.ios_version || '-'}</Info>
        <Info label="Uptime">{fmtUptime(device.uptime_seconds)}</Info>
        <Info label="Last seen">{device.last_seen_at ? new Date(device.last_seen_at).toLocaleString() : '-'}</Info>
        <Info label="CPU">{device.cpu_pct != null ? `${device.cpu_pct}%` : '-'}</Info>
        <Info label="Memory">{device.mem_pct != null ? `${device.mem_pct}%` : '-'}</Info>
        <Info label="Temp">{device.temperature_c != null ? `${device.temperature_c}°C` : '-'}</Info>
        <Info label="PSU">{(device.psu_status ?? []).map((p: any) => `${p.id}:${p.status}`).join(' ') || '-'}</Info>
        <Info label="Fans">{(device.fan_status ?? []).map((f: any) => `${f.id}:${f.status}`).join(' ') || '-'}</Info>
        <Info label="Location">{device.location || '-'}</Info>
      </div>

      <div className="px-6 pt-4">
        <div className="flex gap-1 border-b">
          {(['ports', 'config', 'backups', 'history', 'vlans', 'neighbors'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
                    className={`px-4 py-2 text-sm capitalize ${tab === t ? 'border-b-2 border-brand-600 font-medium text-brand-700' : 'text-gray-500'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6">
        {tab === 'ports' && <PortsTab deviceId={id!} ports={ports} canOperate={canOperate} onChanged={reload} />}
        {tab === 'config' && <ConfigTab deviceId={id!} canConfig={canConfig} />}
        {tab === 'backups' && <BackupsTab deviceId={id!} canOperate={canOperate} canConfig={canConfig} />}
        {tab === 'history' && <HistoryTab deviceId={id!} canConfig={canConfig} />}
        {tab === 'vlans' && <VlansTab deviceId={id!} />}
        {tab === 'neighbors' && <NeighborsTab deviceId={id!} />}
      </div>
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded border bg-white px-3 py-2 text-sm shadow-sm">
      <div className="text-xs uppercase text-gray-400">{label}</div>
      <div className="mt-0.5 truncate">{children}</div>
    </div>
  );
}
