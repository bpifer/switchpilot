import { useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { api } from '../api';
import { useAction } from '../hooks/useAction';
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
import TimelineTab from './device/TimelineTab';

type DeviceTab = 'ports' | 'config' | 'backups' | 'history' | 'neighbors' | 'vlans' | 'tools' | 'timeline';
const TABS: DeviceTab[] = ['ports', 'config', 'backups', 'history', 'vlans', 'neighbors', 'tools', 'timeline'];

export default function DeviceDetail({ me }: { me: Me }) {
  const { id } = useParams<{ id: string }>();
  // Tab lives in the URL (?tab=) so it's bookmarkable and survives refresh
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as DeviceTab | null;
  const tab: DeviceTab = tabParam && TABS.includes(tabParam) ? tabParam : 'ports';
  const setTab = (t: DeviceTab) =>
    setSearchParams(prev => { prev.set('tab', t); return prev; }, { replace: true });
  const [showProvision, setShowProvision] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const canOperate = me.role !== 'readonly';
  const canConfig = me.role === 'superadmin' || me.role === 'netadmin';
  const { run, busy, isBusy } = useAction();

  const { data: device, refetch: refetchDevice, isLoading: deviceLoading } = useApiQuery<any>(`/api/devices/${id}`, { refetchInterval: 60000 });
  const { data: sites = [] } = useApiQuery<{ id: string; name: string }[]>('/api/sites');
  const { data: ports = [], refetch: refetchPorts } = useApiQuery<Port[]>(`/api/devices/${id}/ports`, { refetchInterval: 60000 });
  const { data: avail } = useApiQuery<{ pct: number | null }>(`/api/analytics/device/${id}/availability?days=30`, { refetchInterval: 300000 });
  const reload = () => { refetchDevice(); refetchPorts(); };

  const refresh = () => run(async () => {
    await api(`/api/devices/${id}/refresh`, { method: 'POST' });
    reload();
  });

  // Accept a test-mode config change: cancels the device's revert timer and
  // persists the config. Without this the device reverts at the deadline.
  const acceptChange = () => run(async () => {
    await api(`/api/devices/${id}/config/confirm-change`, { method: 'POST' });
    refetchDevice();
  }, { key: 'accept', success: 'Change accepted — revert timer cancelled and config saved.' });

  if (!device) {
    // Skeleton during the initial fetch; once it settles without a device the
    // id is bad or the device was removed, so show a way back instead of a
    // spinner that never resolves.
    if (deviceLoading) return <DeviceBandSkeleton />;
    return (
      <div className="p-6">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Couldn't load this device — it may have been removed.{' '}
          <Link to="/devices" className="font-medium text-brand-700 underline dark:text-brand-400">Back to devices</Link>
        </p>
      </div>
    );
  }

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
          current={{ siteId: device.site_id ?? '', location: device.location ?? '',
                     rackName: device.rack_name ?? '', rackUnit: device.rack_unit != null ? String(device.rack_unit) : '',
                     rackHeight: device.rack_height != null ? String(device.rack_height) : '1',
                     notes: device.notes ?? '' }}
          onClose={() => setShowSettings(false)}
          onSaved={() => { setShowSettings(false); refetchDevice(); }}
        />
      )}

      {/* Identity + health summary band */}
      <div className="px-6 pt-5">
        <div className="rounded-xl bg-white px-5 py-4 shadow-sm ring-1 ring-slate-200/60 dark:bg-slate-800 dark:ring-slate-700/60">
          <div className="flex flex-wrap items-center gap-x-7 gap-y-2.5">
            <StatusBadge status={device.status} />
            {device.firmware_update && (
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${
                device.firmware_update.state === 'installing'
                  ? 'bg-blue-100 text-blue-700 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-500/20'
                  : 'bg-amber-100 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20'}`}
                    title={device.firmware_update.state === 'installing'
                      ? 'The device is rebooting to apply a firmware update.'
                      : 'A firmware update is downloaded and will apply on the next reboot.'}>
                {device.firmware_update.state === 'installing'
                  ? <>🔄 Firmware updating{device.firmware_update.version ? ` → ${device.firmware_update.version}` : ''}…</>
                  : <>⬇ Firmware update staged{device.firmware_update.version ? ` (${device.firmware_update.version})` : ''} — reboot to apply</>}
              </span>
            )}
            {device.revert_armed_until && new Date(device.revert_armed_until) > new Date() && (
              <span className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20"
                    title="A config change is inside its revert window. Unless it is confirmed (automatically for safe apply, or by you in test mode), the device reverts itself to the pre-change config at this time.">
                ⏳ auto-revert armed until {new Date(device.revert_armed_until).toLocaleTimeString()}
                {canConfig && (
                  <button
                    className="rounded-full bg-amber-600 px-2 py-0.5 text-[11px] font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
                    disabled={busy}
                    onClick={acceptChange}>
                    {isBusy('accept') ? 'Accepting…' : 'Accept change'}
                  </button>
                )}
              </span>
            )}
            <Meta label="Vendor" value={device.vendor ? device.vendor[0].toUpperCase() + device.vendor.slice(1) : null} />
            <Meta label="Model" value={device.model} mono />
            <Meta label="Serial" value={device.serial_number} mono />
            <Meta label="IOS" value={device.ios_version} mono />
            <Meta label="Uptime" value={fmtUptime(device.uptime_seconds)} />
            <Meta label="Ports" value={ports.length ? `${connectedPorts}/${ports.length} up` : null} />
            <Meta label="Site" value={sites.find(s => s.id === device.site_id)?.name ?? null} />
            <Meta label="Location" value={device.location} />
            <Meta label="Last seen" value={device.last_seen_at ? new Date(device.last_seen_at).toLocaleString() : null} />
            <Meta label="Avail 30d" value={avail?.pct != null ? `${avail.pct}%` : null}
                  tone={avail?.pct != null && avail.pct < 99 ? 'warn' : undefined} />
            {device.cert_expires_at && (
              <Meta label="TLS cert" value={certLabel(device.cert_expires_at)} tone={certTone(device.cert_expires_at)} />
            )}
            <HostKeyStatus deviceId={id!} fp={device.ssh_host_key_fp} pinnedAt={device.ssh_host_key_pinned_at}
                           canConfig={canConfig} onChanged={refetchDevice} />
          </div>

          <div className="mt-3.5 flex flex-wrap items-center gap-x-7 gap-y-3 border-t border-slate-100 pt-3.5 dark:border-slate-800">
            {device.vendor === 'aruba' ? (
              /* Confirmed by probing a live 1930: Instant On exposes no CPU,
                 memory, or temperature OIDs, so say so instead of showing an
                 empty row that looks like a polling failure. */
              <span
                className="cursor-help text-sm text-slate-400 dark:text-slate-500"
                title="Aruba Instant On switches don't expose CPU, memory, or temperature over SNMP. Health monitoring for this device covers reachability, port state, and traffic.">
                CPU / memory / temp: not reported by this platform ⓘ
              </span>
            ) : (
              <>
                <Gauge label="CPU" pct={device.cpu_pct} />
                <Gauge label="Memory" pct={device.mem_pct} />
                <Meta label="Temp" value={device.temperature_c != null ? `${device.temperature_c}°C` : null}
                      tone={device.temperature_c >= 55 ? 'warn' : undefined} />
                <HardwareHealth label="PSU" items={psu} />
                <HardwareHealth label="Fans" items={fans} />
              </>
            )}
          </div>

          {device.notes && (
            <div className="mt-3.5 border-t border-slate-100 pt-3.5 dark:border-slate-800">
              <p className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-400">
                <span className="mr-1.5 font-semibold text-slate-500 dark:text-slate-400">Notes:</span>{device.notes}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="px-4 pt-4 sm:px-6">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-700">
          <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
            {TABS.map(t => (
              <button key={t} onClick={() => setTab(t)}
                      className={`shrink-0 whitespace-nowrap px-3 py-2 text-sm capitalize transition-colors sm:px-4 ${tab === t
                        ? 'border-b-2 border-brand-600 font-medium text-brand-700 dark:border-brand-400 dark:text-brand-400'
                        : 'text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-300'}`}>
                {t === 'vlans' ? <span className="normal-case">VLANs</span> : t}
              </button>
            ))}
          </div>
          {canConfig && (
            <button onClick={() => setShowTerminal(true)}
                    className="mb-1 inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-800/50">
              <span className="font-mono">›_</span> <span className="hidden sm:inline">Terminal</span>
            </button>
          )}
        </div>
      </div>

      <div className="p-6">
        {tab === 'ports' && <PortsTab deviceId={id!} ports={ports} canOperate={canOperate} onChanged={reload} vendor={device.vendor} />}
        {tab === 'config' && <ConfigTab deviceId={id!} canConfig={canConfig} vendor={device.vendor} />}
        {tab === 'backups' && <BackupsTab deviceId={id!} canOperate={canOperate} canConfig={canConfig} vendor={device.vendor} />}
        {tab === 'history' && <HistoryTab deviceId={id!} canConfig={canConfig} vendor={device.vendor} />}
        {tab === 'vlans' && <VlansTab deviceId={id!} />}
        {tab === 'neighbors' && <NeighborsTab deviceId={id!} />}
        {tab === 'tools' && <ToolsTab deviceId={id!} canOperate={canOperate} />}
        {tab === 'timeline' && <TimelineTab deviceId={id!} />}
      </div>
    </div>
  );
}

function DeviceSettingsModal({ deviceId, sites, current, onClose, onSaved }: {
  deviceId: string;
  sites: { id: string; name: string }[];
  current: { siteId: string; location: string; rackName: string; rackUnit: string; rackHeight: string; notes: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [siteId, setSiteId] = useState(current.siteId);
  const [location, setLocation] = useState(current.location);
  const [rackName, setRackName] = useState(current.rackName);
  const [rackUnit, setRackUnit] = useState(current.rackUnit);
  const [rackHeight, setRackHeight] = useState(current.rackHeight);
  const [notes, setNotes] = useState(current.notes);
  const [logLevel, setLogLevel] = useState('');   // '' = leave unchanged
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setBusy(true); setError('');
    try {
      await api(`/api/devices/${deviceId}`, {
        method: 'PATCH',
        // siteId '' clears the assignment (nullable on the backend)
        body: {
          siteId: siteId || null, location,
          rackName, rackUnit: rackUnit ? parseInt(rackUnit, 10) : null,
          rackHeight: parseInt(rackHeight, 10) || 1,
          notes,
        }
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
      <div className="grid grid-cols-3 gap-3">
        <Field label="Rack">
          <input className={inputCls} value={rackName} onChange={e => setRackName(e.target.value)} placeholder="e.g. Rack A" />
        </Field>
        <Field label="Position (U)">
          <input type="number" min={1} max={60} className={inputCls} value={rackUnit}
                 onChange={e => setRackUnit(e.target.value)} placeholder="bottom U" />
        </Field>
        <Field label="Height (U)">
          <input type="number" min={1} max={20} className={inputCls} value={rackHeight}
                 onChange={e => setRackHeight(e.target.value)} />
        </Field>
      </div>
      <Field label="Notes">
        <textarea className={inputCls} rows={3} value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Operator notes: cabling quirks, maintenance constraints, etc." />
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
      {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
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
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
        These settings let SwitchPilot use all its features against this switch. A pre-change
        backup is taken automatically, and the push runs as a job you can watch and retry.
      </p>
      {!plan ? (
        <p className="py-4 text-center text-sm text-slate-400 dark:text-slate-500">Building plan…</p>
      ) : (
        <>
          <pre className="mb-3 rounded-lg bg-gray-900 p-3 text-xs leading-relaxed text-green-300">
            {plan.lines.join('\n')}
          </pre>
          <ul className="mb-4 space-y-1 text-xs text-slate-500 dark:text-slate-400">
            {plan.notes.map((n, i) => <li key={i}>• {n}</li>)}
          </ul>
        </>
      )}
      {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {done ? (
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-green-700 dark:text-green-400">Job queued - see the Jobs page for progress.</span>
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
  const { run, busy } = useAction();
  const pinned = !!fp;

  function repin() {
    if (!confirm('Re-pin this device\'s SSH host key?\n\nUse this only after a legitimate re-image or hardware swap — the platform will trust whatever key the device presents on the next connection.')) return;
    run(async () => {
      await api(`/api/devices/${deviceId}/repin-host-key`, { method: 'POST' });
      onChanged();
    });
  }

  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">SSH key</span>
      {pinned ? (
        <span className="font-mono text-xs text-slate-700 dark:text-slate-300"
              title={`${fp}${pinnedAt ? ` — pinned ${new Date(pinnedAt).toLocaleString()}` : ''}`}>
          🔒 {fp!.replace(/^SHA256:/, '').slice(0, 12)}…
        </span>
      ) : (
        <span className="text-sm text-amber-600 dark:text-amber-400" title="Pins automatically on the next successful SSH connection">not pinned</span>
      )}
      {canConfig && pinned && (
        <button onClick={repin} disabled={busy}
                className="ml-0.5 text-xs text-brand-600 hover:underline disabled:opacity-50 dark:text-brand-400">
          {busy ? '…' : 're-pin'}
        </button>
      )}
    </div>
  );
}

function certLabel(iso: string): string {
  const days = Math.floor((new Date(iso).getTime() - Date.now()) / 86_400_000);
  const on = new Date(iso).toLocaleDateString();
  return days < 0 ? `expired ${on}` : `${days}d left (${on})`;
}
function certTone(iso: string): 'warn' | undefined {
  return (new Date(iso).getTime() - Date.now()) / 86_400_000 <= 30 ? 'warn' : undefined;
}

// Loading placeholder that mirrors the device band (title + status, meta row,
// gauge row) so the page doesn't jump from bare text to the full layout.
function DeviceBandSkeleton() {
  return (
    <div className="animate-pulse p-4 sm:p-6" aria-busy="true" aria-label="Loading device">
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:p-5">
        <div className="flex items-center gap-3">
          <div className="h-6 w-48 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-5 w-16 rounded-full bg-slate-200 dark:bg-slate-700" />
        </div>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
          {[64, 96, 80, 72, 88, 60, 100, 76].map((w, i) => (
            <div key={i} className="h-4 rounded bg-slate-200 dark:bg-slate-700" style={{ width: w }} />
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-7 gap-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
          {[112, 112, 96, 80].map((w, i) => (
            <div key={i} className="h-4 rounded bg-slate-200 dark:bg-slate-700" style={{ width: w }} />
          ))}
        </div>
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
      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</span>
      <span className={`text-sm ${mono ? 'font-mono text-xs' : ''} ${tone === 'warn' ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-300'}`}>
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
      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</span>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700/50">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-sm tabular-nums text-slate-700 dark:text-slate-300">{pct}%</span>
    </div>
  );
}

function HardwareHealth({ label, items }: { label: string; items: { id: string; status: string }[] }) {
  if (!items.length) return null;
  const ok = (s: string) => /^(ok|good|normal)$/i.test(s) || /not present/i.test(s);
  const bad = items.filter(i => !ok(i.status));
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</span>
      {bad.length === 0 ? (
        <span className="inline-flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500" /> OK
        </span>
      ) : (
        <span className="text-sm font-medium text-red-600 dark:text-red-400">
          {bad.map(b => `${b.id}: ${b.status}`).join(', ')}
        </span>
      )}
    </div>
  );
}
