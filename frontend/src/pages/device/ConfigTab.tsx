import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api';
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
  const [safeApply, setSafeApply] = useState(false);

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

  async function doPush(force: boolean) {
    setBusy(true);
    try {
      const r = await api(`/api/devices/${deviceId}/config/push`, {
        method: 'POST', body: { lines: lines(), force, confirm: safeApply, confirmSeconds: 120 }
      });
      setPushOut(r.outcome === 'reverting'
        ? 'Applied, but the platform lost contact with the device afterward - it will auto-revert to the pre-change config. Re-check connectivity and try again.'
        : (r.output || 'Applied successfully (config backed up before change).'));
      setPreview(null);
    } catch (err: any) {
      // 409 = server-side self-lockout guard. Surface the specifics and let the
      // user explicitly override (the preview already showed these warnings).
      if (err instanceof ApiError && err.status === 409 && !force) {
        const warns: string[] = (err.detail as any)?.warnings ?? [];
        if (window.confirm(`${err.message}\n\n${warns.join('\n')}\n\nPush anyway? This may cut off management access.`)) {
          return doPush(true);
        }
        setPushOut('Push cancelled by the self-lockout guard.');
      } else {
        setPushOut(`Error: ${err.message}`);
      }
    } finally { setBusy(false); }
  }
  const apply = () => doPush(false);

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
          <label className="mt-2 flex items-center gap-2 text-xs text-slate-500"
                 title="Cisco arms 'reload in N'; RouterOS schedules a backup restore. Either way, if the platform can't reach the device after the change, the device reloads back to the pre-change config.">
            <input type="checkbox" checked={safeApply} onChange={e => setSafeApply(e.target.checked)} />
            Safe apply: if the platform loses access after the change, the device reloads back to the pre-change config in ~2&nbsp;min (Cisco IOS-XE &amp; RouterOS)
          </label>
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
