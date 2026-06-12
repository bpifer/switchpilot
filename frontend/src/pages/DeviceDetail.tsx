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

  const psu = (device.psu_status ?? []) as { id: string; status: string }[];
  const fans = (device.fan_status ?? []) as { id: string; status: string }[];
  const connectedPorts = ports.filter(p => p.oper_status === 'connected').length;

  return (
    <div>
      <PageHeader title={device.hostname || device.mgmt_ip}>
        {canOperate && <Button variant="secondary" onClick={refresh} disabled={busy}>{busy ? 'Refreshing…' : '↻ Refresh now'}</Button>}
      </PageHeader>

      {/* Identity + health summary band */}
      <div className="px-6 pt-5">
        <div className="rounded-xl bg-white px-5 py-4 shadow-sm ring-1 ring-slate-200/60">
          <div className="flex flex-wrap items-center gap-x-7 gap-y-2.5">
            <StatusBadge status={device.status} />
            <Meta label="Model" value={device.model} mono />
            <Meta label="Serial" value={device.serial_number} mono />
            <Meta label="IOS" value={device.ios_version} mono />
            <Meta label="Uptime" value={fmtUptime(device.uptime_seconds)} />
            <Meta label="Ports" value={ports.length ? `${connectedPorts}/${ports.length} up` : null} />
            <Meta label="Location" value={device.location} />
            <Meta label="Last seen" value={device.last_seen_at ? new Date(device.last_seen_at).toLocaleString() : null} />
          </div>

          <div className="mt-3.5 flex flex-wrap items-center gap-x-7 gap-y-3 border-t border-slate-100 pt-3.5">
            <Gauge label="CPU" pct={device.cpu_pct} />
            <Gauge label="Memory" pct={device.mem_pct} />
            <Meta label="Temp" value={device.temperature_c != null ? `${device.temperature_c}°C` : null}
                  tone={device.temperature_c >= 55 ? 'warn' : undefined} />
            <HardwareHealth label="PSU" items={psu} />
            <HardwareHealth label="Fans" items={fans} />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-6 pt-4">
        <div className="flex gap-1 border-b border-slate-200">
          {(['ports', 'config', 'backups', 'history', 'vlans', 'neighbors'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
                    className={`px-4 py-2 text-sm capitalize transition-colors ${tab === t
                      ? 'border-b-2 border-brand-600 font-medium text-brand-700'
                      : 'text-gray-500 hover:text-gray-700'}`}>
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

function Meta({ label, value, mono = false, tone }: {
  label: string; value: string | null | undefined; mono?: boolean; tone?: 'warn';
}) {
  if (!value) return null;
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</span>
      <span className={`text-sm ${mono ? 'font-mono text-xs' : ''} ${tone === 'warn' ? 'font-medium text-amber-600' : 'text-slate-700'}`}>
        {value}
      </span>
    </div>
  );
}

function Gauge({ label, pct }: { label: string; pct: number | null }) {
  if (pct == null) return null;
  const color = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-400' : 'bg-green-500';
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</span>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-sm tabular-nums text-slate-700">{pct}%</span>
    </div>
  );
}

function HardwareHealth({ label, items }: { label: string; items: { id: string; status: string }[] }) {
  if (!items.length) return null;
  const ok = (s: string) => /^(ok|good|normal)$/i.test(s) || /not present/i.test(s);
  const bad = items.filter(i => !ok(i.status));
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</span>
      {bad.length === 0 ? (
        <span className="inline-flex items-center gap-1 text-sm text-green-600">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500" /> OK
        </span>
      ) : (
        <span className="text-sm font-medium text-red-600">
          {bad.map(b => `${b.id}: ${b.status}`).join(', ')}
        </span>
      )}
    </div>
  );
}
