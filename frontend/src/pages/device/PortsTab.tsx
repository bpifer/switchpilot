import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Card, Button, StatusBadge, Modal, Field, inputCls } from '../../components/ui';
import PortGrid, { type Port } from '../../components/PortGrid';

export default function PortsTab({ deviceId, ports, canOperate, onChanged }: {
  deviceId: string; ports: Port[]; canOperate: boolean; onChanged: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const port = ports.find(p => p.name === selected) ?? null;

  return (
    <div className="space-y-4">
      <Card title="Front panel">
        <div className="flex flex-wrap items-start gap-8">
          <PortGrid ports={ports} selected={selected} onSelect={setSelected} />
          {!port && ports.length > 0 && (
            <div className="self-center text-sm text-gray-400">
              Click a port to view details and manage it.
            </div>
          )}
        </div>
      </Card>

      {port && (
        <PortDetail key={port.name} deviceId={deviceId} port={port}
                    canOperate={canOperate} onChanged={onChanged} />
      )}
    </div>
  );
}

function PortDetail({ deviceId, port, canOperate, onChanged }: {
  deviceId: string; port: Port; canOperate: boolean; onChanged: () => void;
}) {
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState('');
  const [editVlan, setEditVlan] = useState(false);
  // Port names contain slashes (Gi1/0/1) - encode so they stay one path segment
  const portPath = encodeURIComponent(port.name);

  useEffect(() => { setResult(''); }, [port.name]);

  async function action(label: string, fn: () => Promise<any>) {
    setBusy(label); setResult('');
    try { const r = await fn(); if (r?.result) setResult(r.result); onChanged(); }
    catch (err: any) { setResult(`Error: ${err.message}`); }
    finally { setBusy(''); }
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
                    onClick={() => action('admin', () => api(`/api/devices/${deviceId}/ports/${portPath}/admin`,
                      { method: 'POST', body: { enabled: !port.admin_up } }))}>
              {busy === 'admin' ? '…' : port.admin_up ? 'Disable' : 'Enable'}
            </Button>
            <Button variant="secondary" disabled={!!busy}
                    onClick={() => action('bounce', () => api(`/api/devices/${deviceId}/ports/${portPath}/bounce`, { method: 'POST' }))}>
              {busy === 'bounce' ? 'Bouncing…' : 'Bounce'}
            </Button>
            <Button variant="secondary" disabled={!!busy}
                    onClick={() => action('tdr', () => api(`/api/devices/${deviceId}/ports/${portPath}/cable-test`, { method: 'POST' }))}>
              {busy === 'tdr' ? 'Testing…' : 'Cable test'}
            </Button>
            <Button onClick={() => setEditVlan(true)}>Edit VLAN / description</Button>
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

      {result && (
        <pre className="mt-4 max-h-56 overflow-auto rounded-lg bg-gray-900 p-3 text-xs leading-relaxed text-green-300">{result}</pre>
      )}

      {editVlan && (
        <PortConfigModal
          port={port}
          busy={busy === 'cfg'}
          onClose={() => setEditVlan(false)}
          onApply={body => action('cfg', async () => {
            await api(`/api/devices/${deviceId}/ports/${portPath}/config`, { method: 'POST', body });
            setEditVlan(false);
          })}
        />
      )}
    </Card>
  );
}

/**
 * Full port configuration. Only fields the operator touches are sent, so an
 * apply never rewrites settings that weren't changed.
 */
function PortConfigModal({ port, busy, onClose, onApply }: {
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
