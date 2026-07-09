import { useState } from 'react';
import { useApiQuery } from '../../hooks/useApiQuery';
import { api, ApiError } from '../../api';
import { Button, inputCls } from '../../components/ui';
import type { Port } from '../../components/PortGrid';

// ── Output pane ───────────────────────────────────────────────────────────────

function OutputPane({ label, output, busy }: { label: string; output: string; busy: boolean }) {
  if (!output && !busy) return null;
  return (
    <div className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200/60 dark:bg-slate-800 dark:ring-slate-700/60">
      <div className="border-b border-slate-100 px-5 py-3 dark:border-slate-700">
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</span>
      </div>
      <pre className="max-h-72 overflow-auto p-4 text-xs leading-relaxed text-green-300 bg-gray-900 rounded-b-xl whitespace-pre-wrap">
        {busy ? 'Running on the device…' : output}
      </pre>
    </div>
  );
}

// ── Tool row ──────────────────────────────────────────────────────────────────

function ToolRow({ label, hint, warn, children }: {
  label: string; hint: string; warn?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[11rem_1fr] gap-x-6 gap-y-1 border-t border-slate-100 px-5 py-4 first:border-t-0 dark:border-slate-700/60 sm:grid-cols-[14rem_1fr]">
      <div className="pt-0.5">
        <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{label}</div>
        <div className={`mt-0.5 text-xs ${warn ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500'}`}>{hint}</div>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        {children}
      </div>
    </div>
  );
}

// ── Section card ──────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200/60 dark:bg-slate-800 dark:ring-slate-700/60">
      <div className="border-b border-slate-100 px-5 py-3 dark:border-slate-700">
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</span>
      </div>
      <div>{children}</div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type NetToolId = 'ping' | 'traceroute' | 'ip-scan';
const NET_LABEL: Record<NetToolId, string> = { ping: 'Ping', traceroute: 'Traceroute', 'ip-scan': 'IP scan' };
const NET_HINT: Record<NetToolId, string> = {
  ping: 'Send ICMP echo requests from the switch to a host or IP.',
  traceroute: 'Trace the network path from the switch to a host or IP.',
  'ip-scan': 'Scan an IPv4 subnet for live hosts.',
};
const NET_PH: Record<NetToolId, string> = {
  ping: '8.8.8.8 or host.example.com',
  traceroute: '8.8.8.8 or host.example.com',
  'ip-scan': '192.168.10.0/24',
};

export default function ToolsTab({ deviceId, canOperate }: { deviceId: string; canOperate: boolean }) {
  const { data: toolsData } = useApiQuery<{ tools: NetToolId[] }>(`/api/devices/${deviceId}/tools`);
  const { data: portsData } = useApiQuery<Port[]>(`/api/devices/${deviceId}/ports`);

  const supportedTools = toolsData?.tools ?? [];
  const ports = (portsData ?? []).filter(p => {
    const n = p.name;
    return n.includes('/') || /^(ether|sfp|qsfp|combo)/i.test(n);
  });

  // Reboot state
  const [rebootConfirm, setRebootConfirm] = useState('');
  const [rebootOpen, setRebootOpen] = useState(false);
  const [rebootBusy, setRebootBusy] = useState(false);

  // Port tools state
  const [bouncePort, setBouncePort] = useState('');
  const [cablePort, setCablePort] = useState('');

  // Shared output pane
  const [output, setOutput] = useState('');
  const [outputLabel, setOutputLabel] = useState('');
  const [busy, setBusy] = useState(false);

  // Network tool state
  const [netTarget, setNetTarget] = useState('');
  const [netCount, setNetCount] = useState(5);

  async function runOutput(label: string, fn: () => Promise<string>) {
    setBusy(true); setOutput(''); setOutputLabel(label);
    try { setOutput(await fn()); }
    catch (err) { setOutput(`Error: ${err instanceof ApiError ? err.message : String(err)}`); }
    finally { setBusy(false); }
  }

  async function doReboot() {
    setRebootBusy(true);
    try {
      const r = await api<{ message: string }>(`/api/devices/${deviceId}/reboot`, {
        method: 'POST', body: { confirm: 'REBOOT' },
      });
      setOutput(r.message);
      setOutputLabel('Reboot');
      setRebootOpen(false);
      setRebootConfirm('');
    } catch (err) {
      setOutput(`Error: ${err instanceof ApiError ? err.message : String(err)}`);
      setOutputLabel('Reboot');
    } finally { setRebootBusy(false); }
  }

  async function doBounce() {
    if (!bouncePort) return;
    runOutput(`Bounce ${bouncePort}`, async () => {
      await api(`/api/devices/${deviceId}/ports/${encodeURIComponent(bouncePort)}/bounce`, { method: 'POST' });
      return `Port ${bouncePort} bounced — shut then no shut (brief link drop).`;
    });
  }

  async function doCableTest() {
    if (!cablePort) return;
    runOutput(`Cable test ${cablePort}`, async () => {
      const r = await api<{ result: string }>(`/api/devices/${deviceId}/ports/${encodeURIComponent(cablePort)}/cable-test`, { method: 'POST' });
      return r.result || '(no result returned)';
    });
  }

  async function doNetTool(tool: NetToolId) {
    if (!netTarget.trim()) return;
    runOutput(`${NET_LABEL[tool]} ${netTarget}`, async () => {
      const r = await api<{ output: string }>(`/api/devices/${deviceId}/tools/${tool}`, {
        method: 'POST',
        body: tool === 'ip-scan' ? { target: netTarget } : { target: netTarget, count: netCount },
      });
      return r.output || '(no output)';
    });
  }

  const portSelect = (value: string, onChange: (v: string) => void) => (
    ports.length > 0 ? (
      <select className={inputCls} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Select port…</option>
        {ports.map(p => (
          <option key={p.name} value={p.name}>
            {p.name}{p.description ? ` — ${p.description}` : ''}
          </option>
        ))}
      </select>
    ) : (
      <input className={inputCls} value={value} onChange={e => onChange(e.target.value)}
             placeholder="e.g. Gi1/0/1" />
    )
  );

  return (
    <div className="space-y-4">
      {/* Device operations */}
      <Section title="Device">
        {/* Reboot */}
        <ToolRow
          label="Reboot device"
          hint="Device will be unreachable for ~1–2 minutes."
          warn
        >
          {!rebootOpen ? (
            <Button variant="danger" disabled={!canOperate || rebootBusy}
                    onClick={() => setRebootOpen(true)}>
              Reboot device
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <input
                className={`${inputCls} w-36 font-mono`}
                value={rebootConfirm}
                onChange={e => setRebootConfirm(e.target.value.toUpperCase())}
                placeholder="Type REBOOT"
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter' && rebootConfirm === 'REBOOT') doReboot(); }}
              />
              <Button variant="danger" disabled={rebootConfirm !== 'REBOOT' || rebootBusy}
                      onClick={doReboot}>
                {rebootBusy ? 'Rebooting…' : 'Confirm reboot'}
              </Button>
              <Button variant="secondary" onClick={() => { setRebootOpen(false); setRebootConfirm(''); }}>
                Cancel
              </Button>
            </div>
          )}
        </ToolRow>

        {/* Port bounce */}
        <ToolRow
          label="Bounce port"
          hint="Briefly shuts then re-enables the port (drops the link for ~1 s)."
          warn
        >
          <div className="w-52">{portSelect(bouncePort, setBouncePort)}</div>
          <Button variant="secondary" disabled={!canOperate || !bouncePort || busy}
                  onClick={doBounce}>
            {busy && outputLabel.startsWith('Bounce') ? 'Bouncing…' : 'Bounce'}
          </Button>
        </ToolRow>

        {/* Cable test */}
        <ToolRow
          label="Cable test (TDR)"
          hint="Tests cable pair continuity and estimates length. May briefly disrupt traffic."
          warn
        >
          <div className="w-52">{portSelect(cablePort, setCablePort)}</div>
          <Button variant="secondary" disabled={!canOperate || !cablePort || busy}
                  onClick={doCableTest}>
            {busy && outputLabel.startsWith('Cable') ? 'Testing…' : 'Run'}
          </Button>
        </ToolRow>
      </Section>

      {/* Network diagnostics */}
      {(toolsData === undefined || supportedTools.length > 0) && (
        <Section title="Network diagnostics">
          {/* Shared target + count inputs used across all net tools */}
          <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-700/60">
            <label className="block min-w-48 flex-1">
              <span className="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400">Target / subnet</span>
              <input className={inputCls} value={netTarget}
                     onChange={e => setNetTarget(e.target.value)}
                     placeholder="8.8.8.8, host.example.com, or 10.0.0.0/24"
                     onKeyDown={e => { if (e.key === 'Enter' && supportedTools[0]) doNetTool(supportedTools[0]); }} />
            </label>
            <label className="block w-24">
              <span className="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400">Count</span>
              <input type="number" min={1} max={10} className={inputCls} value={netCount}
                     onChange={e => setNetCount(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} />
            </label>
          </div>

          {supportedTools.length === 0 && toolsData !== undefined ? (
            <p className="px-5 py-4 text-sm text-slate-400 dark:text-slate-500">
              No network diagnostic tools are available for this device.
            </p>
          ) : (
            supportedTools.map(tool => (
              <ToolRow key={tool} label={NET_LABEL[tool]} hint={NET_HINT[tool]}>
                <Button variant="secondary"
                        disabled={!canOperate || !netTarget.trim() || busy}
                        onClick={() => doNetTool(tool)}>
                  {busy && outputLabel.startsWith(NET_LABEL[tool]) ? 'Running…' : 'Run'}
                </Button>
              </ToolRow>
            ))
          )}

          {!canOperate && (
            <p className="px-5 pb-4 text-xs text-amber-600 dark:text-amber-400">
              You need an operator role to run device tools.
            </p>
          )}
        </Section>
      )}

      <OutputPane label={outputLabel} output={output} busy={busy} />
    </div>
  );
}
