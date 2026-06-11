import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import type { Me } from '../App';
import { PageHeader, Card, Button, StatusBadge, Modal, Field, inputCls, fmtUptime } from '../components/ui';
import PortGrid, { type Port } from '../components/PortGrid';

export default function DeviceDetail({ me }: { me: Me }) {
  const { id } = useParams<{ id: string }>();
  const [device, setDevice] = useState<any>(null);
  const [ports, setPorts] = useState<Port[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<'ports' | 'config' | 'backups' | 'history' | 'neighbors' | 'vlans'>('ports');
  const [busy, setBusy] = useState(false);
  const canOperate = me.role !== 'readonly';
  const canConfig = me.role === 'superadmin' || me.role === 'netadmin';

  const load = () => {
    api(`/api/devices/${id}`).then(setDevice).catch(() => {});
    api(`/api/devices/${id}/ports`).then(setPorts).catch(() => {});
  };
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [id]);

  async function refresh() {
    setBusy(true);
    try { await api(`/api/devices/${id}/refresh`, { method: 'POST' }); load(); }
    catch (err: any) { alert(err.message); }
    finally { setBusy(false); }
  }

  if (!device) return <div className="p-6 text-gray-400">Loading…</div>;
  const port = ports.find(p => p.name === selected) ?? null;

  return (
    <div>
      <PageHeader title={device.hostname || device.mgmt_ip}>
        {canOperate && <Button variant="secondary" onClick={refresh} disabled={busy}>{busy ? 'Refreshing…' : '↻ Refresh now'}</Button>}
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 p-6 pb-0 md:grid-cols-4 lg:grid-cols-6">
        <Info label="Status"><StatusBadge status={device.status} /></Info>
        <Info label="Model">{device.model || '—'}</Info>
        <Info label="Serial">{device.serial_number || '—'}</Info>
        <Info label="IOS">{device.ios_version || '—'}</Info>
        <Info label="Uptime">{fmtUptime(device.uptime_seconds)}</Info>
        <Info label="Last seen">{device.last_seen_at ? new Date(device.last_seen_at).toLocaleString() : '—'}</Info>
        <Info label="CPU">{device.cpu_pct != null ? `${device.cpu_pct}%` : '—'}</Info>
        <Info label="Memory">{device.mem_pct != null ? `${device.mem_pct}%` : '—'}</Info>
        <Info label="Temp">{device.temperature_c != null ? `${device.temperature_c}°C` : '—'}</Info>
        <Info label="PSU">{(device.psu_status ?? []).map((p: any) => `${p.id}:${p.status}`).join(' ') || '—'}</Info>
        <Info label="Fans">{(device.fan_status ?? []).map((f: any) => `${f.id}:${f.status}`).join(' ') || '—'}</Info>
        <Info label="Location">{device.location || '—'}</Info>
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
        {tab === 'ports' && (
          <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
            <Card title="Front panel">
              <PortGrid ports={ports} selected={selected} onSelect={setSelected} />
            </Card>
            <Card title={port ? `Port ${port.name}` : 'Select a port'}>
              {port ? <PortPanel deviceId={id!} port={port} canOperate={canOperate} onChanged={load} /> :
                <div className="text-sm text-gray-400">Click a port on the front panel to view and manage it.</div>}
            </Card>
          </div>
        )}
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

function PortPanel({ deviceId, port, canOperate, onChanged }: {
  deviceId: string; port: Port; canOperate: boolean; onChanged: () => void;
}) {
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState('');
  const [editVlan, setEditVlan] = useState(false);
  const [vlan, setVlan] = useState('');
  const [desc, setDesc] = useState(port.description);

  useEffect(() => { setDesc(port.description); setResult(''); }, [port.name]);

  async function action(label: string, fn: () => Promise<any>) {
    setBusy(label); setResult('');
    try { const r = await fn(); if (r?.result) setResult(r.result); onChanged(); }
    catch (err: any) { setResult(`Error: ${err.message}`); }
    finally { setBusy(''); }
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <div><span className="text-gray-400">Status:</span> <StatusBadge status={port.oper_status} /></div>
        <div><span className="text-gray-400">VLAN:</span> {port.vlan}</div>
        <div><span className="text-gray-400">Speed:</span> {port.speed} {port.duplex}</div>
        <div><span className="text-gray-400">PoE:</span> {port.poe_watts ? `${port.poe_watts} W` : '—'}</div>
        <div><span className="text-gray-400">Errors in/out:</span> {port.input_errors}/{port.output_errors}</div>
        <div><span className="text-gray-400">Flaps (1h):</span> {port.flap_count_1h}</div>
      </div>
      <div>
        <div className="text-gray-400">Description</div>
        <div>{port.description || <span className="text-gray-300">none</span>}</div>
      </div>
      <div>
        <div className="text-gray-400">Learned MACs ({(port.macs ?? []).length})</div>
        <div className="max-h-24 overflow-auto font-mono text-xs">
          {(port.macs ?? []).map(m => <div key={m}>{m}</div>)}
          {(port.macs ?? []).length === 0 && <span className="text-gray-300">none</span>}
        </div>
      </div>

      {canOperate && (
        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Button variant="secondary" disabled={!!busy}
                  onClick={() => action('admin', () => api(`/api/devices/${deviceId}/ports/${port.name}/admin`,
                    { method: 'POST', body: { enabled: !port.admin_up } }))}>
            {busy === 'admin' ? '…' : port.admin_up ? 'Disable' : 'Enable'}
          </Button>
          <Button variant="secondary" disabled={!!busy}
                  onClick={() => action('bounce', () => api(`/api/devices/${deviceId}/ports/${port.name}/bounce`, { method: 'POST' }))}>
            {busy === 'bounce' ? 'Bouncing…' : 'Bounce'}
          </Button>
          <Button variant="secondary" disabled={!!busy}
                  onClick={() => action('tdr', () => api(`/api/devices/${deviceId}/ports/${port.name}/cable-test`, { method: 'POST' }))}>
            {busy === 'tdr' ? 'Testing…' : 'Cable test'}
          </Button>
          <Button variant="secondary" onClick={() => setEditVlan(true)}>Edit VLAN/desc</Button>
        </div>
      )}
      {result && <pre className="max-h-48 overflow-auto rounded bg-gray-900 p-2 text-xs text-green-300">{result}</pre>}

      {editVlan && (
        <Modal title={`Configure ${port.name}`} onClose={() => setEditVlan(false)}>
          <Field label="Access VLAN">
            <input className={inputCls} value={vlan} onChange={e => setVlan(e.target.value)} placeholder={port.vlan} />
          </Field>
          <Field label="Description">
            <input className={inputCls} value={desc} onChange={e => setDesc(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditVlan(false)}>Cancel</Button>
            <Button onClick={() => action('cfg', async () => {
              const body: any = { description: desc };
              if (vlan) { body.mode = 'access'; body.vlan = parseInt(vlan, 10); }
              await api(`/api/devices/${deviceId}/ports/${port.name}/config`, { method: 'POST', body });
              setEditVlan(false);
            })}>{busy === 'cfg' ? 'Applying…' : 'Apply'}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ConfigTab({ deviceId, canConfig }: { deviceId: string; canConfig: boolean }) {
  const [kind, setKind] = useState<'running' | 'startup'>('running');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [pushLines, setPushLines] = useState('');
  const [pushOut, setPushOut] = useState('');

  async function load() {
    setLoading(true);
    try { setContent((await api(`/api/devices/${deviceId}/config/${kind}`)).content); }
    catch (err: any) { setContent(`Error: ${err.message}`); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [kind]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Device configuration">
        <div className="mb-2 flex gap-2">
          {(['running', 'startup'] as const).map(k => (
            <Button key={k} variant={kind === k ? 'primary' : 'secondary'} onClick={() => setKind(k)}>{k}-config</Button>
          ))}
          <Button variant="secondary" onClick={load}>↻</Button>
        </div>
        <pre className="max-h-[32rem] overflow-auto rounded bg-gray-900 p-3 text-xs text-gray-100">
          {loading ? 'Loading from device…' : content}
        </pre>
      </Card>
      {canConfig && (
        <Card title="Push configuration">
          <textarea className="h-64 w-full rounded border p-2 font-mono text-xs"
                    placeholder={'interface GigabitEthernet1/0/10\n description Printer\n switchport access vlan 20'}
                    value={pushLines} onChange={e => setPushLines(e.target.value)} />
          <div className="mt-2 flex justify-end">
            <Button onClick={async () => {
              setPushOut('Pushing…');
              try {
                const r = await api(`/api/devices/${deviceId}/config/push`,
                  { method: 'POST', body: { lines: pushLines.split('\n').filter(l => l.trim()) } });
                setPushOut(r.output || 'Applied successfully (config backed up before change).');
              } catch (err: any) { setPushOut(`Error: ${err.message}`); }
            }} disabled={!pushLines.trim()}>Push & save</Button>
          </div>
          {pushOut && <pre className="mt-2 max-h-40 overflow-auto rounded bg-gray-900 p-2 text-xs text-green-300">{pushOut}</pre>}
        </Card>
      )}
    </div>
  );
}

function BackupsTab({ deviceId, canOperate, canConfig }: { deviceId: string; canOperate: boolean; canConfig: boolean }) {
  const [backups, setBackups] = useState<any[]>([]);
  const [diff, setDiff] = useState('');
  const [showBackup, setShowBackup] = useState(false);
  const [reason, setReason] = useState('');
  const [ticket, setTicket] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => api(`/api/devices/${deviceId}/backups`).then(setBackups).catch(() => {});
  useEffect(() => { load(); }, []);

  async function takeBackup() {
    setBusy(true);
    try {
      await api(`/api/devices/${deviceId}/backups`, { method: 'POST', body: { reason, ticket } });
      setShowBackup(false); setReason(''); setTicket(''); load();
    } catch (err: any) { alert(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Configuration backups">
        {canOperate && <Button onClick={() => setShowBackup(true)}>Backup now</Button>}
        <table className="mt-3 w-full text-sm">
          <thead><tr className="border-b text-left text-xs uppercase text-gray-500">
            <th className="py-1">Taken</th><th>By</th><th>Reason</th><th>Ticket</th><th>Size</th><th></th></tr></thead>
          <tbody>
            {backups.map(b => (
              <tr key={b.id} className="border-b last:border-0">
                <td className="py-1.5">{new Date(b.created_at).toLocaleString()}</td>
                <td>{b.taken_by}</td>
                <td className="max-w-32 truncate text-slate-600" title={b.reason || undefined}>{b.reason || '—'}</td>
                <td className="font-mono text-xs text-slate-600">{b.ticket || '—'}</td>
                <td>{(b.size / 1024).toFixed(1)} KB</td>
                <td className="space-x-2 text-right">
                  <button className="text-xs text-brand-600 hover:underline"
                          onClick={async () => setDiff((await api(`/api/devices/${deviceId}/diff?from=${b.id}&to=live`)).diff)}>
                    diff vs live
                  </button>
                  {canConfig && (
                    <button className="text-xs text-red-600 hover:underline"
                            onClick={async () => {
                              if (!confirm('Replay this backup onto the device? A pre-restore backup is taken first.')) return;
                              await api(`/api/devices/${deviceId}/restore/${b.id}`, { method: 'POST' });
                              alert('Restore pushed.');
                            }}>restore</button>
                  )}
                </td>
              </tr>
            ))}
            {backups.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-gray-400">No backups yet</td></tr>}
          </tbody>
        </table>
      </Card>
      <Card title="Diff">
        <pre className="max-h-[32rem] overflow-auto rounded bg-gray-900 p-3 text-xs leading-relaxed">
          {diff ? diff.split('\n').map((l, i) => (
            <div key={i} className={l.startsWith('+') ? 'text-green-400' : l.startsWith('-') ? 'text-red-400' : 'text-gray-300'}>{l}</div>
          )) : <span className="text-gray-400">Select “diff vs live” on a backup.</span>}
        </pre>
      </Card>

      {showBackup && (
        <Modal title="Take configuration backup" onClose={() => setShowBackup(false)}>
          <p className="mb-3 text-sm text-slate-500">
            Recording a reason and change ticket makes the git history auditable. Both are optional.
          </p>
          <Field label="Reason">
            <input className={inputCls} value={reason} onChange={e => setReason(e.target.value)}
                   placeholder="e.g. Pre-change snapshot before VLAN 30 rollout" autoFocus />
          </Field>
          <Field label="Change ticket">
            <input className={inputCls} value={ticket} onChange={e => setTicket(e.target.value)} placeholder="e.g. CHG0012345" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowBackup(false)}>Cancel</Button>
            <Button onClick={takeBackup} disabled={busy}>{busy ? 'Backing up…' : 'Backup now'}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function HistoryTab({ deviceId, canConfig }: { deviceId: string; canConfig: boolean }) {
  const [log, setLog] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<string[]>([]);   // up to 2 selected SHAs for diff
  const [diff, setDiff] = useState('');
  const [viewing, setViewing] = useState<{ sha: string; content: string } | null>(null);
  const [rollingBack, setRollingBack] = useState('');

  async function rollback(sha: string) {
    if (!confirm(`Roll the device back to ${sha.slice(0, 8)}? The current config is snapshotted first, so this is reversible.`)) return;
    setRollingBack(sha);
    try {
      await api(`/api/devices/${deviceId}/config/rollback/${sha}`, { method: 'POST' });
      alert('Rollback pushed to device.');
    } catch (err: any) { alert(err.message); }
    finally { setRollingBack(''); }
  }

  useEffect(() => {
    api(`/api/devices/${deviceId}/config/git-log`)
      .then(setLog).catch(() => setLog([])).finally(() => setLoading(false));
  }, [deviceId]);

  const toggle = (sha: string) => setSel(prev =>
    prev.includes(sha) ? prev.filter(s => s !== sha) : [...prev, sha].slice(-2));

  async function runDiff() {
    if (sel.length !== 2) return;
    // git-log is newest-first; diff older→newer for readable +/-
    const [a, b] = sel;
    const ai = log.findIndex(e => e.sha === a), bi = log.findIndex(e => e.sha === b);
    const [from, to] = ai > bi ? [a, b] : [b, a];
    try { setDiff((await api(`/api/devices/${deviceId}/config/git-diff?from=${from}&to=${to}`)).diff); }
    catch (err: any) { setDiff(`Error: ${err.message}`); }
  }

  async function view(sha: string) {
    try { setViewing({ sha, content: (await api(`/api/devices/${deviceId}/config/git-show/${sha}`)).content }); }
    catch (err: any) { setViewing({ sha, content: `Error: ${err.message}` }); }
  }

  if (loading) return <div className="py-8 text-center text-sm text-slate-400">Loading config history…</div>;
  if (log.length === 0) return (
    <div className="py-10 text-center text-sm text-slate-400">
      No config history yet — commits appear after the first backup that records a change.
    </div>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Config history">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs text-slate-400">Select two commits to compare.</span>
          <Button variant="secondary" onClick={runDiff} disabled={sel.length !== 2}>Compare ({sel.length}/2)</Button>
        </div>
        <ol className="relative space-y-3 border-l border-slate-200 pl-4">
          {log.map(e => (
            <li key={e.sha} className="relative">
              <span className="absolute -left-[1.3rem] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-400 ring-2 ring-white" />
              <div className={`rounded-lg border p-2.5 transition ${sel.includes(e.sha) ? 'border-brand-400 bg-brand-50/50' : 'border-slate-200'}`}>
                <div className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1 rounded border-slate-300"
                         checked={sel.includes(e.sha)} onChange={() => toggle(e.sha)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-slate-400">{e.sha.slice(0, 8)}</span>
                      <span className="text-xs text-slate-500">{new Date(e.date).toLocaleString()}</span>
                    </div>
                    <div className="mt-0.5 text-sm text-slate-700">{e.subject}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{e.author}</span>
                      {e.reason && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">{e.reason}</span>}
                      {e.ticket && <span className="rounded bg-violet-50 px-1.5 py-0.5 font-mono text-violet-700">{e.ticket}</span>}
                      <button className="ml-auto text-brand-600 hover:underline" onClick={() => view(e.sha)}>view</button>
                      {canConfig && (
                        <button className="text-red-600 hover:underline disabled:opacity-50"
                                disabled={rollingBack === e.sha} onClick={() => rollback(e.sha)}>
                          {rollingBack === e.sha ? 'rolling back…' : 'rollback'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </Card>
      <Card title="Diff">
        <pre className="max-h-[32rem] overflow-auto rounded bg-gray-900 p-3 text-xs leading-relaxed">
          {diff ? diff.split('\n').map((l, i) => (
            <div key={i} className={l.startsWith('+') && !l.startsWith('+++') ? 'text-green-400'
              : l.startsWith('-') && !l.startsWith('---') ? 'text-red-400'
              : l.startsWith('@@') ? 'text-cyan-400' : 'text-gray-300'}>{l}</div>
          )) : <span className="text-gray-400">Select two commits and press Compare.</span>}
        </pre>
      </Card>

      {viewing && (
        <Modal title={`Config at ${viewing.sha.slice(0, 8)}`} onClose={() => setViewing(null)}>
          <pre className="max-h-[60vh] overflow-auto rounded bg-gray-900 p-3 text-xs text-gray-100">{viewing.content}</pre>
        </Modal>
      )}
    </div>
  );
}

function NeighborsTab({ deviceId }: { deviceId: string }) {
  const [neighbors, setNeighbors] = useState<any[]>([]);
  useEffect(() => { api(`/api/devices/${deviceId}/neighbors`).then(setNeighbors).catch(() => {}); }, []);
  return (
    <Card title="CDP / LLDP neighbors">
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left text-xs uppercase text-gray-500">
          <th className="py-1">Local port</th><th>Neighbor</th><th>Neighbor port</th><th>IP</th><th>Platform</th><th>Via</th></tr></thead>
        <tbody>
          {neighbors.map(n => (
            <tr key={n.id} className="border-b last:border-0">
              <td className="py-1.5 font-mono text-xs">{n.local_port}</td>
              <td>{n.neighbor_name}</td>
              <td className="font-mono text-xs">{n.neighbor_port}</td>
              <td className="font-mono text-xs">{n.neighbor_ip}</td>
              <td>{n.neighbor_platform}</td>
              <td className="uppercase text-xs text-gray-500">{n.protocol}</td>
            </tr>
          ))}
          {neighbors.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-gray-400">No neighbors discovered yet</td></tr>}
        </tbody>
      </table>
    </Card>
  );
}

const VLAN_PALETTE = [
  '#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6',
  '#06b6d4','#f97316','#84cc16','#ec4899','#6366f1',
  '#14b8a6','#a855f7','#eab308','#f43f5e','#0ea5e9',
];

function VlansTab({ deviceId }: { deviceId: string }) {
  const [data, setData] = useState<{ vlans: any[]; trunkPorts: string[] } | null>(null);

  useEffect(() => {
    api(`/api/analytics/device/${deviceId}/vlans`).then(setData).catch(() => {});
  }, [deviceId]);

  if (!data) return <div className="py-8 text-center text-sm text-slate-400">Loading VLAN data…</div>;

  const { vlans, trunkPorts } = data;

  if (vlans.length === 0 && trunkPorts.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-slate-400">
        No VLAN data yet — collected on the next device refresh.
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
                className="rounded-md bg-slate-100 px-2.5 py-1 font-mono text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                {p}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Trunk ports carry all allowed VLANs — see your running config for allowed VLAN list.
          </p>
        </Card>
      )}

      <Card title="VLAN membership">
        <div className="space-y-3">
          {vlans.map((v, idx) => {
            const color = VLAN_PALETTE[idx % VLAN_PALETTE.length];
            const ports: string[] = v.ports ?? [];
            return (
              <div key={v.id} className="flex items-start gap-3 rounded-lg border border-slate-100 p-3">
                <div
                  className="mt-0.5 h-5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800">VLAN {v.id}</span>
                    {v.name && v.name !== `VLAN${v.id}` && (
                      <span className="text-sm text-slate-500">{v.name}</span>
                    )}
                    <span className="ml-auto text-xs text-slate-400">
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
                    <span className="text-xs text-slate-400">No access ports</span>
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
