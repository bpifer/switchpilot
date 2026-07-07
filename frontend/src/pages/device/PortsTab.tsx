import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api';
import { useApiQuery } from '../../hooks/useApiQuery';
import { Card, Button, StatusBadge, Modal, Field, inputCls, rowActionCls } from '../../components/ui';
import PortGrid, { type Port } from '../../components/PortGrid';
import ConfigPreviewModal, { type PreviewData } from '../../components/ConfigPreviewModal';

interface PortSample {
  recorded_at: string;
  in_bps: number | null;
  out_bps: number | null;
  in_errors: number;
  out_errors: number;
  status: string;
}

// Device read-back result returned by the port-config apply endpoint.
interface PortVerification {
  ok: boolean;
  checked: boolean;
  confirmed: string[];
  mismatches: { field: string; expected: string; actual: string }[];
}

function fmtBps(bps: number): string {
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(1)} Gbps`;
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)} Mbps`;
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(0)} Kbps`;
  return `${bps} bps`;
}

export default function PortsTab({ deviceId, ports, canOperate, onChanged }: {
  deviceId: string; ports: Port[]; canOperate: boolean; onChanged: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const port = ports.find(p => p.name === selected) ?? null;

  // Filter the grid by name/description/VLAN so a "where's the AP on vlan 100"
  // question is a quick type, not a scan of 48 ports.
  const q = filter.trim().toLowerCase();
  const shown = q
    ? ports.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q) ||
        String(p.vlan ?? '').toLowerCase().includes(q))
    : ports;

  return (
    <div className="space-y-4">
      <Card title="Front panel">
        {ports.length > 0 && (
          <div className="mb-3 flex items-center gap-2">
            <input className={`${inputCls} max-w-xs`} value={filter} onChange={e => setFilter(e.target.value)}
                   placeholder="Filter ports by name, description, or VLAN…" />
            {q && <span className="text-xs text-slate-400">{shown.length} of {ports.length}</span>}
          </div>
        )}
        <div className="flex flex-wrap items-start gap-8">
          <PortGrid ports={shown} selected={selected} onSelect={setSelected} />
          {!port && ports.length > 0 && (
            <div className="self-center text-sm text-gray-400">
              {shown.length === 0 ? 'No ports match the filter.' : 'Click a port to view details and manage it.'}
            </div>
          )}
        </div>
      </Card>

      {port && (
        <PortDetail key={port.name} deviceId={deviceId} port={port}
                    canOperate={canOperate} onChanged={onChanged} />
      )}

      {canOperate && <BulkConfigPanel deviceId={deviceId} ports={ports} onChanged={onChanged} />}

      {canOperate && <LagPanel deviceId={deviceId} ports={ports} onChanged={onChanged} />}
    </div>
  );
}

// Apply one port configuration to several ports at once (the most common
// switch task: N access ports for the same VLAN/profile). Reuses the same
// modal, dry-run preview, and per-port apply endpoint as the single-port flow;
// the preview runs against the first selected port, the apply hits each port
// sequentially (the SSH pool serializes per device anyway) and reports per port.
function BulkConfigPanel({ deviceId, ports, onChanged }: {
  deviceId: string; ports: Port[]; onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [pendingBody, setPendingBody] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [results, setResults] = useState<string[]>([]);

  // Physical ports only - LAG virtual interfaces are configured individually.
  const physical = ports.filter(p => !/^Po\d+$/i.test(p.name) && !/^bond/i.test(p.name));
  const first = physical.find(p => p.name === sel[0]);

  const toggle = (name: string) =>
    setSel(s => (s.includes(name) ? s.filter(x => x !== name) : [...s, name]));

  // Step 1: dry-run the edit against the first selected port and show the diff.
  async function startPreview(body: any) {
    setShowModal(false); setResults([]);
    setBusy(true);
    try {
      const p = await api<PreviewData>(
        `/api/devices/${deviceId}/ports/${encodeURIComponent(sel[0])}/config/preview`,
        { method: 'POST', body });
      setPreview(p); setPendingBody(body);
    } catch (err: any) {
      setResults([`✗ preview failed: ${err.message}`]);
    } finally { setBusy(false); }
  }

  // Step 2: operator confirmed - apply to every selected port, one at a time,
  // continuing past failures and reporting each port's outcome.
  async function applyAll() {
    if (!pendingBody) return;
    if (!confirm(`Apply this configuration to ${sel.length} port${sel.length === 1 ? '' : 's'}?\n\n${sel.join(', ')}`)) return;
    setPreview(null); setBusy(true); setResults([]);
    const out: string[] = [];
    for (const [i, name] of sel.entries()) {
      setProgress(`Applying ${i + 1}/${sel.length}: ${name}`);
      try {
        const r = await api<{ warning?: string; verified?: PortVerification | null }>(
          `/api/devices/${deviceId}/ports/${encodeURIComponent(name)}/config`,
          { method: 'POST', body: pendingBody });
        const v = r?.verified;
        if (v?.checked && !v.ok) {
          out.push(`⚠ ${name}: applied, but read-back differs (${v.mismatches.map(m => `${m.field}: expected ${m.expected}, got ${m.actual}`).join('; ')})`);
        } else {
          out.push(`✓ ${name}${r?.warning ? ` — ${r.warning}` : ''}`);
        }
      } catch (err: any) {
        out.push(`✗ ${name}: ${err.message}`);
      }
      setResults([...out]);
    }
    setProgress(''); setBusy(false); setPendingBody(null);
    onChanged();
  }

  return (
    <Card title="Bulk configure">
      {!open ? (
        <Button variant="secondary" onClick={() => setOpen(true)}>Configure multiple ports…</Button>
      ) : (
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Ports ({sel.length} selected)
            </div>
            <div className="grid max-h-48 grid-cols-3 gap-1 overflow-auto sm:grid-cols-4 lg:grid-cols-6">
              {physical.map(p => (
                <label key={p.name}
                       className={`flex items-center gap-1.5 rounded border px-2 py-1 text-xs ${sel.includes(p.name) ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600'}`}>
                  <input type="checkbox" checked={sel.includes(p.name)} onChange={() => toggle(p.name)} />
                  <span className="truncate font-mono">{p.name}</span>
                </label>
              ))}
            </div>
          </div>
          <p className="text-xs text-slate-400">
            One configuration, applied to every selected port. The preview compares against the first
            selected port; each port then gets its own apply with device read-back verification.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setOpen(false); setSel([]); setResults([]); }}>Cancel</Button>
            <Button onClick={() => setShowModal(true)} disabled={busy || sel.length === 0}>
              {busy && !preview && !progress ? 'Checking…'
                : sel.length === 0 ? 'Configure ports…'
                : `Configure ${sel.length} port${sel.length === 1 ? '' : 's'}…`}
            </Button>
          </div>
          {progress && <p className="text-xs font-medium text-slate-500">{progress}</p>}
          {results.length > 0 && (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-900 p-3 text-xs leading-relaxed text-green-300">{results.join('\n')}</pre>
          )}
        </div>
      )}

      {showModal && first && (
        <PortConfigModal
          port={{ ...first, name: `${sel.length} ports`, description: '' }}
          busy={busy}
          onClose={() => setShowModal(false)}
          onApply={startPreview}
        />
      )}

      {preview && (
        <ConfigPreviewModal
          title={`Apply to ${sel.length} ports (preview: ${sel[0]})`}
          data={preview}
          busy={busy}
          applyLabel={`Apply to ${sel.length} ports`}
          onApply={applyAll}
          onClose={() => { setPreview(null); setPendingBody(null); }}
        />
      )}
    </Card>
  );
}

// Create a link-aggregation group (port-channel / bond) from >= 2 member ports,
// and list/delete existing ones (detected by name: Cisco Po<N>, RouterOS bond*).
function LagPanel({ deviceId, ports, onChanged }: { deviceId: string; ports: Port[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [lagId, setLagId] = useState('');
  const [mode, setMode] = useState<'lacp' | 'static'>('lacp');
  const [members, setMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  // A pending delete: the LAG port plus (Cisco only) its member ports to detach.
  const [deleting, setDeleting] = useState<Port | null>(null);
  const [delMembers, setDelMembers] = useState<string[]>([]);
  const isRos = ports.some(p => /^(ether|sfp-)/i.test(p.name));

  const isLagPort = (p: Port) => /^Po\d+$/i.test(p.name) || /^bond/i.test(p.name);
  const lags = ports.filter(isLagPort);
  const physical = ports.filter(p => !isLagPort(p));

  const toggle = (name: string) =>
    setMembers(m => (m.includes(name) ? m.filter(x => x !== name) : [...m, name]));
  const toggleDel = (name: string) =>
    setDelMembers(m => (m.includes(name) ? m.filter(x => x !== name) : [...m, name]));

  async function create() {
    setBusy(true); setResult('');
    try {
      const r = await api<{ output?: string }>(`/api/devices/${deviceId}/lag`,
        { method: 'POST', body: { id: lagId.trim(), members, mode } });
      setResult(r.output || `LAG ${lagId} created.`);
      setMembers([]); setLagId('');
      onChanged();
    } catch (err: any) {
      setResult(`Error: ${err.message}`);
    } finally { setBusy(false); }
  }

  // RouterOS derives the bond's slaves on the device; Cisco needs the member
  // ports named so each gets `no channel-group` (membership isn't readable
  // from the ports table).
  async function removeLag(lag: Port, memberPorts: string[]) {
    setBusy(true); setResult('');
    try {
      const id = /^Po\d+$/i.test(lag.name) ? lag.name.replace(/^Po/i, '') : lag.name;
      const r = await api<{ output?: string }>(
        `/api/devices/${deviceId}/lag/${encodeURIComponent(id)}/delete`,
        { method: 'POST', body: { members: memberPorts } });
      setResult(r.output || `LAG ${lag.name} deleted.`);
      setDeleting(null); setDelMembers([]);
      onChanged();
    } catch (err: any) {
      setResult(`Error: ${err.message}`);
    } finally { setBusy(false); }
  }

  function startDelete(lag: Port) {
    if (/^bond/i.test(lag.name)) {
      // RouterOS: the device knows the slaves; a confirm is all that's needed.
      if (confirm(`Delete ${lag.name}? Its member ports return to normal switching.`)) void removeLag(lag, []);
    } else {
      setDeleting(lag); setDelMembers([]);
    }
  }

  return (
    <Card title="Link aggregation (LAG)">
      {lags.length > 0 && (
        <div className="mb-4">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Existing LAGs
          </div>
          <div className="space-y-1">
            {lags.map(l => (
              <div key={l.name} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-1.5 text-sm">
                <span className="font-mono font-medium text-slate-800">{l.name}</span>
                <StatusBadge status={l.oper_status} />
                {l.speed && <span className="text-xs text-slate-500">{l.speed}</span>}
                {l.description && <span className="truncate text-xs text-slate-400">{l.description}</span>}
                <button className={`${rowActionCls} ml-auto text-red-600 disabled:opacity-50`}
                        disabled={busy} onClick={() => startDelete(l)}>
                  delete
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {deleting && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50/50 p-3">
          <div className="mb-1 text-sm font-medium text-slate-800">Delete {deleting.name}</div>
          <p className="mb-2 text-xs text-slate-500">
            Select the member ports of this port-channel so each gets its channel-group removed
            (membership is on the device, not in the inventory - check <span className="font-mono">show etherchannel summary</span> if unsure).
          </p>
          <div className="grid max-h-40 grid-cols-3 gap-1 overflow-auto sm:grid-cols-4 lg:grid-cols-6">
            {physical.map(p => (
              <label key={p.name}
                     className={`flex items-center gap-1.5 rounded border px-2 py-1 text-xs ${delMembers.includes(p.name) ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 text-slate-600'}`}>
                <input type="checkbox" checked={delMembers.includes(p.name)} onChange={() => toggleDel(p.name)} />
                <span className="truncate font-mono">{p.name}</span>
              </label>
            ))}
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setDeleting(null); setDelMembers([]); }}>Cancel</Button>
            <Button variant="danger" disabled={busy || delMembers.length === 0}
                    onClick={() => {
                      if (confirm(`Delete ${deleting.name} and detach ${delMembers.length} member port(s)? Links on those ports stay up but leave the bundle.`))
                        void removeLag(deleting, delMembers);
                    }}>
              {busy ? 'Deleting…' : 'Delete LAG'}
            </Button>
          </div>
        </div>
      )}

      {!open ? (
        <Button variant="secondary" onClick={() => setOpen(true)}>Create a LAG / port-channel</Button>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label={isRos ? 'Bond name' : 'Channel-group #'}>
              <input className={inputCls} value={lagId} onChange={e => setLagId(e.target.value)}
                     placeholder={isRos ? 'bond1' : '1'} />
            </Field>
            <Field label="Mode">
              <select className={inputCls} value={mode} onChange={e => setMode(e.target.value as any)}>
                <option value="lacp">LACP (active)</option>
                <option value="static">Static (always on)</option>
              </select>
            </Field>
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Member ports ({members.length} selected, need 2+)
            </div>
            <div className="grid max-h-48 grid-cols-3 gap-1 overflow-auto sm:grid-cols-4 lg:grid-cols-6">
              {ports.map(p => (
                <label key={p.name}
                       className={`flex items-center gap-1.5 rounded border px-2 py-1 text-xs ${members.includes(p.name) ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600'}`}>
                  <input type="checkbox" checked={members.includes(p.name)} onChange={() => toggle(p.name)} />
                  <span className="truncate font-mono">{p.name}</span>
                </label>
              ))}
            </div>
          </div>
          {isRos && (
            <p className="text-xs text-amber-600">
              On a RouterOS switch chip a bond can be CPU-forwarded (no hardware offload) - fine for 1G links, a bottleneck on 10G SFP+.
            </p>
          )}
          <p className="text-xs text-slate-400">
            The members are bundled into one logical link. Configure the device on the other end to match (same LACP/static mode).
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setOpen(false); setResult(''); }}>Cancel</Button>
            <Button onClick={create} disabled={busy || members.length < 2 || !lagId.trim()}>
              {busy ? 'Creating…' : 'Create LAG'}
            </Button>
          </div>
          {result && <pre className="max-h-40 overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-green-300">{result}</pre>}
        </div>
      )}
    </Card>
  );
}

function PortDetail({ deviceId, port, canOperate, onChanged }: {
  deviceId: string; port: Port; canOperate: boolean; onChanged: () => void;
}) {
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState('');
  const [editVlan, setEditVlan] = useState(false);
  // A pending port edit: the dry-run diff plus the body we'll apply on confirm.
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [pendingBody, setPendingBody] = useState<any | null>(null);
  // Port names contain slashes (Gi1/0/1) - encode so they stay one path segment
  const portPath = encodeURIComponent(port.name);

  useEffect(() => { setResult(''); }, [port.name]);

  async function action(label: string, fn: () => Promise<any>) {
    setBusy(label); setResult('');
    try { const r = await fn(); if (r?.result) setResult(r.result); onChanged(); }
    catch (err: any) { setResult(`Error: ${err.message}`); }
    finally { setBusy(''); }
  }

  // Destructive single-click actions get a lightweight confirm first (the safe
  // Configure path already has the preview modal). Native confirm by design -
  // it just needs to catch a stray click, not be a styled dialog.
  function confirmAction(label: string, message: string, fn: () => Promise<any>) {
    if (window.confirm(message)) void action(label, fn);
  }

  // Uplink guard: the server 409s a bounce/disable on a port with a discovered
  // neighbor (taking it down could cut the switch off from the platform).
  // Surface the server's explanation and let the operator override explicitly.
  const withUplinkOverride = (fn: (force: boolean) => Promise<any>) => async () => {
    try { return await fn(false); }
    catch (err: any) {
      if (err instanceof ApiError && err.status === 409) {
        if (window.confirm(`${err.message}\n\nProceed anyway?`)) return fn(true);
        return { result: 'Cancelled by the uplink guard.' };
      }
      throw err;
    }
  };

  // Step 1 of a config change: dry-run the edit and show the diff before applying.
  async function startPreview(body: any) {
    setBusy('preview'); setResult('');
    try {
      const p = await api<PreviewData>(`/api/devices/${deviceId}/ports/${portPath}/config/preview`,
        { method: 'POST', body });
      setPreview(p); setPendingBody(body); setEditVlan(false);
    } catch (err: any) {
      setEditVlan(false);
      setResult(`Error: ${err.message}`);
    } finally { setBusy(''); }
  }

  // Step 2: the operator confirmed the diff - push the change to the device.
  function applyConfig() {
    if (!pendingBody) return;
    action('cfg', async () => {
      const r = await api<{ warning?: string; verified?: PortVerification | null }>(
        `/api/devices/${deviceId}/ports/${portPath}/config`, { method: 'POST', body: pendingBody });
      setPreview(null); setPendingBody(null);
      // Compose feedback: RouterOS vlan-filtering caveat + device read-back result.
      const notes: string[] = [];
      if (r?.warning) notes.push(`Note: ${r.warning}`);
      const v = r?.verified;
      if (v?.checked && !v.ok) {
        notes.push('⚠ Applied, but the device read-back does not match:\n' +
          v.mismatches.map(m => `  ${m.field}: expected ${m.expected}, device shows ${m.actual}`).join('\n'));
      } else if (v?.checked && v.confirmed.length > 0) {
        notes.push(`✓ Verified on device (${v.confirmed.join(', ')}).`);
      }
      return notes.length ? { result: notes.join('\n') } : undefined;
    });
  }

  const macs = port.macs ?? [];

  return (
    <Card>
      {/* Header: name, status, description, actions */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-3">
          <span className="font-mono text-lg font-semibold text-slate-800">{port.name}</span>
          <StatusBadge status={port.oper_status} />
        </div>
        <span className="text-sm text-slate-500">
          {port.description || <span className="text-slate-300">no description</span>}
        </span>
        {canOperate && (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="secondary" disabled={!!busy}
                    onClick={() => {
                      const enabled = !port.admin_up;
                      const run = withUplinkOverride(force =>
                        api(`/api/devices/${deviceId}/ports/${portPath}/admin`, { method: 'POST', body: { enabled, force } }));
                      // Disabling drops the link; enabling a port is safe.
                      if (enabled) action('admin', run);
                      else confirmAction('admin', `Disable ${port.name}? This drops the link on this port.`, run);
                    }}>
              {busy === 'admin' ? '…' : port.admin_up ? 'Disable' : 'Enable'}
            </Button>
            <Button variant="secondary" disabled={!!busy}
                    onClick={() => confirmAction('bounce', `Bounce ${port.name}? This briefly drops the link (shut / no shut).`,
                      withUplinkOverride(force =>
                        api(`/api/devices/${deviceId}/ports/${portPath}/bounce`, { method: 'POST', body: { force } })))}>
              {busy === 'bounce' ? 'Bouncing…' : 'Bounce'}
            </Button>
            {port.poe_watts != null && (
              <Button variant="secondary" disabled={!!busy}
                      onClick={() => confirmAction('poe', `PoE-cycle ${port.name}? This power-cycles the attached device (AP / camera / phone).`,
                        () => api(`/api/devices/${deviceId}/ports/${portPath}/poe-cycle`, { method: 'POST' }))}>
                {busy === 'poe' ? 'Power-cycling…' : 'PoE cycle'}
              </Button>
            )}
            <Button variant="secondary" disabled={!!busy}
                    onClick={() => action('tdr', () => api(`/api/devices/${deviceId}/ports/${portPath}/cable-test`, { method: 'POST' }))}>
              {busy === 'tdr' ? 'Testing…' : 'Cable test'}
            </Button>
            <Button onClick={() => setEditVlan(true)}>Configure</Button>
          </div>
        )}
      </div>

      {/* Stat tiles */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="VLAN" value={port.vlan} sub={port.mode !== 'access' ? port.mode : undefined} />
        <Stat label="Speed" value={port.speed || '-'} sub={port.duplex || undefined} />
        <Stat label="PoE" value={port.poe_watts ? `${port.poe_watts} W` : '-'} />
        <Stat label="Errors in" value={String(port.input_errors ?? 0)}
              tone={(port.input_errors ?? 0) > 0 ? 'warn' : undefined} />
        <Stat label="Errors out" value={String(port.output_errors ?? 0)}
              tone={(port.output_errors ?? 0) > 0 ? 'warn' : undefined} />
        <Stat label="Flaps (1h)" value={String(port.flap_count_1h ?? 0)}
              tone={(port.flap_count_1h ?? 0) >= 5 ? 'warn' : undefined} />
      </div>

      {/* Learned MACs */}
      <div className="mt-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Learned MACs ({macs.length})
        </div>
        {macs.length > 0 ? (
          <div className="grid max-h-48 grid-cols-2 gap-x-4 gap-y-1 overflow-auto font-mono text-xs text-slate-600 sm:grid-cols-4 lg:grid-cols-6">
            {macs.map(m => <div key={m}>{m}</div>)}
          </div>
        ) : (
          <span className="text-sm text-slate-300">none</span>
        )}
      </div>

      {/* SFP optics (DDM) for fiber/SFP ports */}
      {/^(sfp|qsfp|Te|Tw|Fo|Hu|Twe|Fi)/i.test(port.name) && (
        <SfpOptics deviceId={deviceId} portPath={portPath} />
      )}

      {/* History */}
      <PortHistory deviceId={deviceId} portPath={portPath} />

      {result && (
        <pre className="mt-4 max-h-56 overflow-auto rounded-lg bg-gray-900 p-3 text-xs leading-relaxed text-green-300">{result}</pre>
      )}

      {editVlan && (
        <PortConfigModal
          port={port}
          busy={busy === 'preview'}
          onClose={() => setEditVlan(false)}
          onApply={startPreview}
        />
      )}

      {preview && (
        <ConfigPreviewModal
          title={`Apply to ${port.name}`}
          data={preview}
          busy={busy === 'cfg'}
          applyLabel="Apply & save"
          onApply={applyConfig}
          onClose={() => { setPreview(null); setPendingBody(null); }}
        />
      )}
    </Card>
  );
}

function PortHistory({ deviceId, portPath }: { deviceId: string; portPath: string }) {
  const [hours, setHours] = useState(24);
  const { data: samples = [] } = useApiQuery<PortSample[]>(
    `/api/devices/${deviceId}/ports/${portPath}/metrics?hours=${hours}`,
    { refetchInterval: 60000 });

  const W = 600, H = 80;
  const inVals = samples.map(s => s.in_bps ?? 0);
  const outVals = samples.map(s => s.out_bps ?? 0);
  const max = Math.max(...inVals, ...outVals, 1);
  const x = (i: number) => samples.length > 1 ? (i / (samples.length - 1)) * W : 0;
  const y = (v: number) => H - (v / max) * (H - 6) - 3;
  const line = (vals: number[]) => vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">History</span>
        <div className="flex gap-1">
          {[24, 72, 168].map(h => (
            <button key={h}
              className={`rounded px-2 py-0.5 text-[11px] ${hours === h ? 'bg-brand-50 font-medium text-brand-700 ring-1 ring-brand-200' : 'text-slate-400 hover:text-slate-600'}`}
              onClick={() => setHours(h)}>
              {h === 24 ? '24h' : h === 72 ? '3d' : '7d'}
            </button>
          ))}
        </div>
        {samples.length > 0 && (
          <span className="ml-auto flex items-center gap-3 text-[11px] text-slate-400">
            <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-3 bg-sky-500" />in</span>
            <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-3 bg-emerald-500" />out</span>
            <span>peak {fmtBps(max)}</span>
          </span>
        )}
      </div>

      {samples.length < 2 ? (
        <div className="rounded-lg border border-slate-100 bg-slate-50/60 py-6 text-center text-xs text-slate-400">
          Not enough samples yet - one is recorded on each metrics sweep (every 5 minutes).
        </div>
      ) : (
        <div className="rounded-lg border border-slate-100 p-3">
          {/* Traffic */}
          <svg viewBox={`0 0 ${W} ${H}`} className="h-20 w-full" preserveAspectRatio="none">
            <line x1="0" y1={H - 3} x2={W} y2={H - 3} stroke="#e2e8f0" strokeWidth="1" />
            <polyline points={line(inVals)} fill="none" stroke="#0ea5e9" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            <polyline points={line(outVals)} fill="none" stroke="#10b981" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          </svg>
          {/* Link status timeline */}
          <div className="mt-2 flex h-2 w-full overflow-hidden rounded-sm" title="Link status over the period">
            {samples.map((s, i) => (
              <span key={i} className={`h-full flex-1 ${s.status === 'connected' ? 'bg-green-400' : s.status === 'err-disabled' ? 'bg-red-400' : 'bg-slate-200'}`} />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-slate-400">
            <span>{new Date(samples[0].recorded_at).toLocaleString()}</span>
            <span>{new Date(samples[samples.length - 1].recorded_at).toLocaleString()}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function SfpOptics({ deviceId, portPath }: { deviceId: string; portPath: string }) {
  const { data, isLoading } = useApiQuery<any>(
    `/api/devices/${deviceId}/ports/${portPath}/sfp`, { refetchInterval: 60000 });
  if (isLoading || !data) return null;

  const header = (
    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Optics (SFP / DDM)</div>
  );
  if (data.present === false) {
    return <div className="mt-4">{header}<span className="text-sm text-slate-300">No transceiver inserted.</span></div>;
  }
  const stats: [string, string | null, boolean?][] = [
    ['Temp', data.temperatureC != null ? `${data.temperatureC} °C` : null, data.temperatureC > 70],
    ['Voltage', data.voltageV != null ? `${data.voltageV} V` : null],
    ['Tx power', data.txPowerDbm != null ? `${data.txPowerDbm} dBm` : null],
    ['Rx power', data.rxPowerDbm != null ? `${data.rxPowerDbm} dBm` : null, data.rxPowerDbm != null && data.rxPowerDbm < -20],
    ['Bias', data.txBiasMa != null ? `${data.txBiasMa} mA` : null],
    ['Vendor', data.vendor || null],
    ['Part', data.partNumber || null],
    ['Wavelength', data.wavelengthNm != null ? `${data.wavelengthNm} nm` : null],
  ];
  const shown = stats.filter(s => s[1]);
  return (
    <div className="mt-4">
      {header}
      {shown.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {shown.map(([k, v, warn]) => <Stat key={k} label={k} value={v as string} tone={warn ? 'warn' : undefined} />)}
        </div>
      ) : data.raw ? (
        <pre className="max-h-56 overflow-auto rounded-lg bg-gray-900 p-3 text-xs leading-relaxed text-green-300">{data.raw}</pre>
      ) : (
        <span className="text-sm text-slate-300">No optical data exposed by this port.</span>
      )}
    </div>
  );
}

/**
 * Full port configuration. Only fields the operator touches are sent, so an
 * apply never rewrites settings that weren't changed.
 * Exported for unit tests.
 */
export function PortConfigModal({ port, busy, onClose, onApply }: {
  port: Port; busy: boolean; onClose: () => void; onApply: (body: any) => void;
}) {
  const [mode, setMode] = useState<'unchanged' | 'access' | 'trunk'>('unchanged');
  const [vlan, setVlan] = useState('');
  const [voiceVlan, setVoiceVlan] = useState('');
  const [nativeVlan, setNativeVlan] = useState('');
  const [allowedVlans, setAllowedVlans] = useState('');
  const [desc, setDesc] = useState(port.description);
  const [descTouched, setDescTouched] = useState(false);
  const [speed, setSpeed] = useState('');
  const [duplex, setDuplex] = useState('');
  const [portfast, setPortfast] = useState<'' | 'on' | 'off'>('');
  const [bpduGuard, setBpduGuard] = useState<'' | 'on' | 'off'>('');
  const [poe, setPoe] = useState<'' | 'on' | 'off'>('');

  function apply() {
    const body: any = {};
    if (descTouched) body.description = desc;
    if (mode === 'access') {
      body.mode = 'access';
      if (vlan) body.vlan = parseInt(vlan, 10);
    } else if (mode === 'trunk') {
      body.mode = 'trunk';
      if (nativeVlan) body.trunkNativeVlan = parseInt(nativeVlan, 10);
      if (allowedVlans) body.trunkAllowedVlans = allowedVlans;
    } else if (vlan) {
      body.vlan = parseInt(vlan, 10);
    }
    if (voiceVlan) body.voiceVlan = parseInt(voiceVlan, 10);
    if (speed) body.speed = speed;
    if (duplex) body.duplex = duplex;
    if (portfast) body.portfast = portfast === 'on';
    if (bpduGuard) body.bpduGuard = bpduGuard === 'on';
    if (poe) body.poeEnabled = poe === 'on';
    if (Object.keys(body).length === 0) { onClose(); return; }
    onApply(body);
  }

  const selCls = inputCls;
  return (
    <Modal title={`Configure ${port.name}`} onClose={onClose}>
      <Field label="Description">
        <input className={inputCls} value={desc}
               onChange={e => { setDesc(e.target.value); setDescTouched(true); }} />
      </Field>

      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Switching</div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Port mode">
          <select className={selCls} value={mode} onChange={e => setMode(e.target.value as any)}>
            <option value="unchanged">Keep current ({port.mode})</option>
            <option value="access">Access</option>
            <option value="trunk">Trunk</option>
          </select>
        </Field>
        {mode !== 'trunk' ? (
          <Field label="Access VLAN">
            <input className={inputCls} value={vlan} onChange={e => setVlan(e.target.value)} placeholder={port.vlan} />
          </Field>
        ) : (
          <Field label="Native VLAN">
            <input className={inputCls} value={nativeVlan} onChange={e => setNativeVlan(e.target.value)} placeholder="1" />
          </Field>
        )}
      </div>
      {mode === 'trunk' ? (
        <Field label="Allowed VLANs (e.g. 10,20,30-39 - blank = all)">
          <input className={inputCls} value={allowedVlans} onChange={e => setAllowedVlans(e.target.value)} />
        </Field>
      ) : (
        <Field label="Voice VLAN (optional)">
          <input className={inputCls} value={voiceVlan} onChange={e => setVoiceVlan(e.target.value)} placeholder="e.g. 100" />
        </Field>
      )}

      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Link</div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Speed">
          <select className={selCls} value={speed} onChange={e => setSpeed(e.target.value)}>
            <option value="">Keep current ({port.speed || 'auto'})</option>
            <option value="auto">Auto-negotiate</option>
            <option value="10">10 Mbps</option>
            <option value="100">100 Mbps</option>
            <option value="1000">1 Gbps</option>
          </select>
        </Field>
        <Field label="Duplex">
          <select className={selCls} value={duplex} onChange={e => setDuplex(e.target.value)}>
            <option value="">Keep current ({port.duplex || 'auto'})</option>
            <option value="auto">Auto</option>
            <option value="full">Full</option>
            <option value="half">Half</option>
          </select>
        </Field>
      </div>

      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Spanning tree &amp; power</div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="PortFast">
          <select className={selCls} value={portfast} onChange={e => setPortfast(e.target.value as any)}>
            <option value="">Keep current</option>
            <option value="on">Enabled</option>
            <option value="off">Disabled</option>
          </select>
        </Field>
        <Field label="BPDU Guard">
          <select className={selCls} value={bpduGuard} onChange={e => setBpduGuard(e.target.value as any)}>
            <option value="">Keep current</option>
            <option value="on">Enabled</option>
            <option value="off">Disabled</option>
          </select>
        </Field>
        <Field label="PoE">
          <select className={selCls} value={poe} onChange={e => setPoe(e.target.value as any)}>
            <option value="">Keep current</option>
            <option value="on">Auto (on)</option>
            <option value="off">Never (off)</option>
          </select>
        </Field>
      </div>
      {mode === 'trunk' && (
        <p className="mb-3 text-xs text-amber-600">
          Careful: changing your own uplink to the wrong trunk settings can cut off management access.
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={apply} disabled={busy}>{busy ? 'Applying…' : 'Apply'}</Button>
      </div>
    </Modal>
  );
}

function Stat({ label, value, sub, tone }: {
  label: string; value: string; sub?: string; tone?: 'warn';
}) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-0.5 text-sm font-medium ${tone === 'warn' ? 'text-amber-600' : 'text-slate-800'}`}>
        {value}
        {sub && <span className="ml-1.5 text-xs font-normal text-slate-400">{sub}</span>}
      </div>
    </div>
  );
}
