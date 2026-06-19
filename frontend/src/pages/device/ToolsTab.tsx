import { useState } from 'react';
import { useApiQuery } from '../../hooks/useApiQuery';
import { api, ApiError } from '../../api';
import { Card, Button, inputCls } from '../../components/ui';

type ToolId = 'ping' | 'traceroute' | 'ip-scan';

const LABEL: Record<ToolId, string> = { ping: 'Ping', traceroute: 'Traceroute', 'ip-scan': 'IP scan' };
const HINT: Record<ToolId, string> = {
  ping: 'Send echo requests to a host or IP from the switch.',
  traceroute: 'Trace the network path to a host or IP from the switch.',
  'ip-scan': 'Scan an IPv4 subnet for live hosts.',
};
const PLACEHOLDER: Record<ToolId, string> = {
  ping: '8.8.8.8 or host.example.com',
  traceroute: '8.8.8.8 or host.example.com',
  'ip-scan': '192.168.10.0/24',
};

// Diagnostic tools run on the device itself (ping/traceroute/ip-scan). Which
// tools exist depends on the vendor, so the supported set comes from the API.
export default function ToolsTab({ deviceId, canOperate }: { deviceId: string; canOperate: boolean }) {
  const { data } = useApiQuery<{ tools: ToolId[] }>(`/api/devices/${deviceId}/tools`);
  const loading = data === undefined;
  const tools = data?.tools ?? [];

  const [tool, setTool] = useState<ToolId>('ping');
  const [target, setTarget] = useState('');
  const [count, setCount] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [output, setOutput] = useState('');
  const [ranLabel, setRanLabel] = useState('');

  // Keep the selected tool within what this vendor actually supports.
  const active: ToolId = tools.includes(tool) ? tool : (tools[0] ?? 'ping');
  const canRun = canOperate && target.trim().length > 0 && !busy;

  async function run() {
    setBusy(true); setError(''); setOutput(''); setRanLabel('');
    try {
      const res = await api<{ output: string }>(`/api/devices/${deviceId}/tools/${active}`, {
        method: 'POST',
        body: active === 'ip-scan' ? { target } : { target, count },
      });
      setOutput(res.output || '(no output)');
      setRanLabel(`${LABEL[active]} ${target}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to run tool');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card title="Network tools">
        {loading ? (
          <p className="text-sm text-slate-400">Loading tools…</p>
        ) : tools.length === 0 ? (
          <p className="text-sm text-slate-400">No diagnostic tools are available for this device.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <label className="block w-40">
                <span className="mb-1.5 block text-sm font-medium text-slate-700">Tool</span>
                <select className={inputCls} value={active} onChange={e => setTool(e.target.value as ToolId)}>
                  {tools.map(t => <option key={t} value={t}>{LABEL[t]}</option>)}
                </select>
              </label>
              <label className="block min-w-56 flex-1">
                <span className="mb-1.5 block text-sm font-medium text-slate-700">Target</span>
                <input
                  className={inputCls} value={target} onChange={e => setTarget(e.target.value)}
                  placeholder={PLACEHOLDER[active]}
                  onKeyDown={e => { if (e.key === 'Enter' && canRun) run(); }}
                />
              </label>
              {active !== 'ip-scan' && (
                <label className="block w-24">
                  <span className="mb-1.5 block text-sm font-medium text-slate-700">Count</span>
                  <input
                    type="number" min={1} max={10} className={inputCls} value={count}
                    onChange={e => setCount(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                  />
                </label>
              )}
              <Button onClick={run} disabled={!canRun}>{busy ? 'Running…' : 'Run'}</Button>
            </div>
            <p className="mt-2 text-xs text-slate-400">{HINT[active]}</p>
            {!canOperate && (
              <p className="mt-1 text-xs text-amber-600">You need an operator role to run device tools.</p>
            )}
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          </>
        )}
      </Card>

      {(output || busy) && (
        <Card title={ranLabel || 'Output'}>
          <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-lg bg-gray-900 p-3 text-xs leading-relaxed text-green-300">
            {busy ? 'Running on the device…' : output}
          </pre>
        </Card>
      )}
    </div>
  );
}
