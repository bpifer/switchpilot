import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Card, Button } from '../../components/ui';
import ConfigPreviewModal, { type PreviewData } from '../../components/ConfigPreviewModal';

export default function ConfigTab({ deviceId, canConfig }: { deviceId: string; canConfig: boolean }) {
  const [kind, setKind] = useState<'running' | 'startup'>('running');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [pushLines, setPushLines] = useState('');
  const [pushOut, setPushOut] = useState('');
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try { setContent((await api(`/api/devices/${deviceId}/config/${kind}`)).content); }
    catch (err: any) { setContent(`Error: ${err.message}`); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [kind]);

  const lines = () => pushLines.split('\n').filter(l => l.trim());

  function downloadConfig() {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${kind}-config-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function runPreview() {
    setBusy(true); setPushOut('');
    try { setPreview(await api(`/api/devices/${deviceId}/config/preview`, { method: 'POST', body: { lines: lines() } })); }
    catch (err: any) { setPushOut(`Error: ${err.message}`); }
    finally { setBusy(false); }
  }

  async function apply() {
    setBusy(true);
    try {
      const r = await api(`/api/devices/${deviceId}/config/push`, { method: 'POST', body: { lines: lines() } });
      setPushOut(r.output || 'Applied successfully (config backed up before change).');
      setPreview(null);
    } catch (err: any) { setPushOut(`Error: ${err.message}`); }
    finally { setBusy(false); }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Device configuration">
        <div className="mb-2 flex gap-2">
          {(['running', 'startup'] as const).map(k => (
            <Button key={k} variant={kind === k ? 'primary' : 'secondary'} onClick={() => setKind(k)}>{k}-config</Button>
          ))}
          <Button variant="secondary" onClick={load}>↻</Button>
          <Button variant="secondary" onClick={downloadConfig} disabled={!content || loading}>Download</Button>
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
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-slate-400">Preview shows what changes and flags risky lines before applying.</span>
            <Button onClick={runPreview} disabled={!pushLines.trim() || busy}>
              {busy && !preview ? 'Checking…' : 'Preview & push'}
            </Button>
          </div>
          {pushOut && <pre className="mt-2 max-h-40 overflow-auto rounded bg-gray-900 p-2 text-xs text-green-300">{pushOut}</pre>}
        </Card>
      )}

      {preview && (
        <ConfigPreviewModal
          title="Push configuration"
          data={preview}
          busy={busy}
          applyLabel="Push & save"
          onApply={apply}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
