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
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <Card title="Front panel">
        <PortGrid ports={ports} selected={selected} onSelect={setSelected} />
      </Card>
      <Card title={port ? `Port ${port.name}` : 'Select a port'}>
        {port ? <PortPanel deviceId={deviceId} port={port} canOperate={canOperate} onChanged={onChanged} /> :
          <div className="text-sm text-gray-400">Click a port on the front panel to view and manage it.</div>}
      </Card>
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
        <div><span className="text-gray-400">PoE:</span> {port.poe_watts ? `${port.poe_watts} W` : '-'}</div>
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
