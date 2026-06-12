import { useState } from 'react';
import { api } from '../../api';
import { useApiQuery } from '../../hooks/useApiQuery';
import { Card, Button, Modal, Field, inputCls } from '../../components/ui';

export default function BackupsTab({ deviceId, canOperate, canConfig }: {
  deviceId: string; canOperate: boolean; canConfig: boolean;
}) {
  const { data: backups = [], refetch } = useApiQuery<any[]>(`/api/devices/${deviceId}/backups`);
  const [diff, setDiff] = useState('');
  const [showBackup, setShowBackup] = useState(false);
  const [reason, setReason] = useState('');
  const [ticket, setTicket] = useState('');
  const [busy, setBusy] = useState(false);

  async function takeBackup() {
    setBusy(true);
    try {
      await api(`/api/devices/${deviceId}/backups`, { method: 'POST', body: { reason, ticket } });
      setShowBackup(false); setReason(''); setTicket(''); refetch();
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
                <td className="max-w-32 truncate text-slate-600" title={b.reason || undefined}>{b.reason || '-'}</td>
                <td className="font-mono text-xs text-slate-600">{b.ticket || '-'}</td>
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
