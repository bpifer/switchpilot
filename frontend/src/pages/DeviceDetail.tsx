import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useApiQuery } from '../hooks/useApiQuery';
import type { Me } from '../App';
import { PageHeader, Button, StatusBadge, fmtUptime, Modal, Field, inputCls } from '../components/ui';
import type { Port } from '../components/PortGrid';
import DeviceTerminal from '../components/DeviceTerminal';
import PortsTab from './device/PortsTab';
import ConfigTab from './device/ConfigTab';
import BackupsTab from './device/BackupsTab';
import HistoryTab from './device/HistoryTab';
import NeighborsTab from './device/NeighborsTab';
import VlansTab from './device/VlansTab';
import ToolsTab from './device/ToolsTab';

type DeviceTab = 'ports' | 'config' | 'backups' | 'history' | 'neighbors' | 'vlans' | 'tools';
const TABS: DeviceTab[] = ['ports', 'config', 'backups', 'history', 'vlans', 'neighbors', 'tools'];

export default function DeviceDetail({ me }: { me: Me }) {
  const { id } = useParams<{ id: string }>();
  // Tab lives in the URL (?tab=) so it's bookmarkable and survives refresh
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as DeviceTab | null;
  const tab: DeviceTab = tabParam && TABS.includes(tabParam) ? tabParam : 'ports';
  const setTab = (t: DeviceTab) =>
    setSearchParams(prev => { prev.set('tab', t); return prev; }, { replace: true });
  const [busy, setBusy] = useState(false);
  const [showProvision, setShowProvision] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const canOperate = me.role !== 'readonly';
  const canConfig = me.role === 'superadmin' || me.role === 'netadmin';

  const { data: device, refetch: refetchDevice } = useApiQuery<any>(`/api/devices/${id}`, { refetchInterval: 60000 });
  const { data: sites = [] } = useApiQuery<{ id: string; name: string }[]>('/api/sites');
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
        {canConfig && <Button variant="secondary" onClick={() => setShowSettings(true)}>Settings</Button>}
        {canConfig && <Button variant="secondary" onClick={() => setShowProvision(true)}>Baseline config</Button>}
        {canOperate && <Button variant="secondary" onClick={refresh} disabled={busy}>{busy ? 'Refreshing…' : '↻ Refresh now'}</Button>}
      </PageHeader>

      {showTerminal && (
        <DeviceTerminal deviceId={id!} hostname={device.hostname || device.mgmt_ip} onClose={() => setShowTerminal(false)} />
      )}

      {showProvision && <ProvisionModal deviceId={id!} onClose={() => setShowProvision(false)} />}
      {showSettings && (
        <DeviceSettingsModal
          deviceId={id!} sites={sites}
          current={{ siteId: device.site_id ?? '', location: device.location ?? '' }}
          onClose={() => setShowSettings(false)}
          onSaved={() => { setShowSettings(false); refetchDevice(); }}
        />
      )}

      {/* Identity + health summary band */}
      <div className="px-6 pt-5">
        <div className="rounded-xl bg-white px-5 py-4 shadow-sm ring-1 ring-slate-200/60">
          <div className="flex flex-wrap items-center gap-x-7 gap-y-2.5">
            <StatusBadge status={device.status} />
            <Meta label="Vendor" value={device.vendor ? device.vendor[0].toUpperCase() + device.vendor.slice(1) : null} />
            <Meta label="Model" value={device.model} mono />
            <Meta label="Serial" value={device.serial_number} mono />
            <Meta label="IOS" value={device.ios_version} mono />
            <Meta label="Uptime" value={fmtUptime(device.uptime_seconds)} />
            <Meta label="Ports" value={ports.length ? `${connectedPorts}/${ports.length} up` : null} />
            <Meta label="Site" value={sites.find(s => s.id === device.site_id)?.name ?? null} />
            <Meta label="Location" value={device.location} />
            <Meta label="Last seen" value={device.last_seen_at ? new Date(device.last_seen_at).toLocaleString() : null} />
            <HostKeyStatus deviceId={id!} fp={device.ssh_host_key_fp} pinnedAt={device.ssh_host_key_pinned_at}
                           canConfig={canConfig} onChanged={refetchDevice} />
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
        <div className="flex items-center justify-between border-b border-slate-200">
          <div className="flex gap-1">
            {TABS.map(t => (
              <button key={t} onClick={() => setTab(t)}
                      className={`px-4 py-2 text-sm capitalize transition-colors ${tab === t
                        ? 'border-b-2 border-brand-600 font-medium text-brand-700'
                        : 'text-gray-500 hover:text-gray-700'}`}>
                {t === 'vlans' ? <span className="normal-case">VLANs</span> : t}
              </button>
            ))}
          </div>
          {canConfig && (
            <button onClick={() => setShowTerminal(true)}
                    className="mb-1 inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
              <span className="font-mono">›_</span> Terminal
            </button>
          )}
        </div>
      </div>

      <div className="p-6">
        {tab === 'ports' && <PortsTab deviceId={id!} ports={ports} canOperate={canOperate} onChanged={reload} />}
        {tab === 'config' && <ConfigTab deviceId={id!} canConfig={canConfig} />}
        {tab === 'backups' && <BackupsTab deviceId={id!} canOperate={canOperate} canConfig={canConfig} />}
        {tab === 'history' && <HistoryTab deviceId={id!} canConfig={canConfig} />}
        {tab === 'vlans' && <VlansTab deviceId={id!} />}
        {tab === 'neighbors' && <NeighborsTab deviceId={id!} />}
        {tab === 'tools' && <ToolsTab deviceId={id!} canOperate={canOperate} />}
      </div>
    </div>
  );
}

function DeviceSettingsModal({ deviceId, sites, current, onClose, onSaved }: {
  deviceId: string;
  sites: { id: string; name: string }[];
  current: { siteId: string; location: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [siteId, setSiteId] = useState(current.siteId);
  const [location, setLocation] = useState(current.location);
  const [logLevel, setLogLevel] = useState('');   // '' = leave unchanged
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setBusy(true); setError('');
    try {
      await api(`/api/devices/${deviceId}`, {
        method: 'PATCH',
        // siteId '' clears the assignment (nullable on the backend)
        body: { siteId: siteId || null, location }
      });
      // Syslog level is a config push, only sent when explicitly chosen
      if (logLevel) {
        await api(`/api/devices/${deviceId}/logging-level`, { method: 'POST', body: { level: logLevel } });
      }
      onSaved();
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal title="Device settings" onClose={onClose}>
      <Field label="Site">
        <select className={inputCls} value={siteId} onChange={e => setSiteId(e.target.value)}>
          <option value="">Unassigned</option>
          {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Field>
      <Field label="Location">
        <input className={inputCls} value={location} onChange={e => setLocation(e.target.value)}
               placeholder="e.g. IDF-2, rack 4" />
      </Field>
      <Field label="Syslog level (pushed to the switch)">
        <select className={inputCls} value={logLevel} onChange={e => setLogLevel(e.target.value)}>
          <option value="">Leave unchanged</option>
          <option value="emergencies">0 - emergencies</option>
          <option value="alerts">1 - alerts</option>
          <option value="critical">2 - critical</option>
          <option value="errors">3 - errors</option>
          <option value="warnings">4 - warnings</option>
          <option value="notifications">5 - notifications</option>
          <option value="informational">6 - informational (default)</option>
          <option value="debugging">7 - debugging</option>
        </select>
      </Field>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
      </div>
    </Modal>
  );
}

function ProvisionModal({ deviceId, onClose }: { deviceId: string; onClose: () => void }) {
  const { data: plan } = useApiQuery<{ lines: string[]; notes: string[] }>(`/api/devices/${deviceId}/provision`);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function apply() {
    setBusy(true); setError('');
    try {
      await api(`/api/devices/${deviceId}/provision`, { method: 'POST' });
      setDone(true);
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal title="Baseline configuration" onClose={onClose}>
      <p className="mb-3 text-sm text-slate-500">
        These settings let SwitchPilot use all its features against this switch. A pre-change
        backup is taken automatically, and the push runs as a job you can watch and retry.
      </p>
      {!plan ? (
        <p className="py-4 text-center text-sm text-slate-400">Building plan…</p>
      ) : (
        <>
          <pre className="mb-3 rounded-lg bg-gray-900 p-3 text-xs leading-relaxed text-green-300">
            {plan.lines.join('\n')}
          </pre>
          <ul className="mb-4 space-y-1 text-xs text-slate-500">
            {plan.notes.map((n, i) => <li key={i}>• {n}</li>)}
          </ul>
        </>
      )}
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      {done ? (
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-green-700">Job queued - see the Jobs page for progress.</span>
          <Button onClick={onClose}>Close</Button>
        </div>
      ) : (
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={apply} disabled={busy || !plan}>{busy ? 'Queueing…' : 'Apply baseline'}</Button>
        </div>
      )}
    </Modal>
  );
}

// SSH host-key pin status + a netadmin re-pin action (after a legitimate
// re-image/replacement). Pinning happens automatically on first connect.
function HostKeyStatus({ deviceId, fp, pinnedAt, canConfig, onChanged }: {
  deviceId: string; fp?: string; pinnedAt?: string | null; canConfig: boolean; onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const pinned = !!fp;

  async function repin() {
    if (!confirm('Re-pin this device\'s SSH host key?\n\nUse this only after a legitimate re-image or hardware swap — the platform will trust whatever key the device presents on the next connection.')) return;
    setBusy(true);
    try { await api(`/api/devices/${deviceId}/repin-host-key`, { method: 'POST' }); onChanged(); }
    catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">SSH key</span>
      {pinned ? (
        <span className="font-mono text-xs text-slate-700"
              title={`${fp}${pinnedAt ? ` — pinned ${new Date(pinnedAt).toLocaleString()}` : ''}`}>
          🔒 {fp!.replace(/^SHA256:/, '').slice(0, 12)}…
        </span>
      ) : (
        <span className="text-sm text-amber-600" title="Pins automatically on the next successful SSH connection">not pinned</span>
      )}
      {canConfig && pinned && (
        <button onClick={repin} disabled={busy}
                className="ml-0.5 text-xs text-brand-600 hover:underline disabled:opacity-50">
          {busy ? '…' : 're-pin'}
        </button>
      )}
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
