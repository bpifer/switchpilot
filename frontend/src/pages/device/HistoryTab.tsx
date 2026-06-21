import { useState } from 'react';
import { api } from '../../api';
import { toast } from '../../components/Toast';
import { useApiQuery } from '../../hooks/useApiQuery';
import { Card, Button, Modal } from '../../components/ui';

export default function HistoryTab({ deviceId, canConfig }: { deviceId: string; canConfig: boolean }) {
  const { data: log = [], isLoading } = useApiQuery<any[]>(`/api/devices/${deviceId}/config/git-log`);
  const [sel, setSel] = useState<string[]>([]);   // up to 2 selected SHAs for diff
  const [diff, setDiff] = useState('');
  const [viewing, setViewing] = useState<{ sha: string; content: string } | null>(null);
  const [rollingBack, setRollingBack] = useState('');

  async function rollback(sha: string) {
    if (!confirm(`Roll the device back to ${sha.slice(0, 8)}? The current config is snapshotted first, so this is reversible.`)) return;
    setRollingBack(sha);
    try {
      await api(`/api/devices/${deviceId}/config/rollback/${sha}`, { method: 'POST' });
      toast.success('Rollback pushed to device.');
    } catch (err: any) { toast.error(err.message); }
    finally { setRollingBack(''); }
  }

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

  if (isLoading) return <div className="py-8 text-center text-sm text-slate-400">Loading config history…</div>;
  if (log.length === 0) return (
    <div className="py-10 text-center text-sm text-slate-400">
      No config history yet - commits appear after the first backup that records a change.
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
