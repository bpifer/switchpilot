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
  const [vlan, setVlan] = useState('');
  const [desc, setDesc] = useState(port.description);
  // Port names contain slashes (Gi1/0/1) - encode so they stay one path segment
  const portPath = encodeURIComponent(port.name);

  useEffect(() => { setDesc(port.description); setResult(''); }, [port.name]);

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
        <Modal title={`Configure ${port.name}`} onClose={() => setEditVlan(false)}>
          <Field label="Access VLAN">
            <input className={inputCls} value={vlan} onChange={e => setVlan(e.target.value)} placeholder={port.vlan} />
          </Field>
          <Field label="Description">
            <input className={inputCls} value={desc} onChange={e => setDesc(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditVlan(false)}>Cancel</Button>
            <Button disabled={busy === 'cfg'} onClick={() => action('cfg', async () => {
              const body: any = { description: desc };
              if (vlan) { body.mode = 'access'; body.vlan = parseInt(vlan, 10); }
              await api(`/api/devices/${deviceId}/ports/${portPath}/config`, { method: 'POST', body });
              setEditVlan(false);
            })}>{busy === 'cfg' ? 'Applying…' : 'Apply'}</Button>
          </div>
        </Modal>
      )}
    </Card>
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
