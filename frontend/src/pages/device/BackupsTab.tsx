import { useState } from 'react';
import { api } from '../../api';
import { useAction } from '../../hooks/useAction';
import { useApiQuery } from '../../hooks/useApiQuery';
import { Card, Button, Modal, Field, inputCls } from '../../components/ui';
import ConfigPreviewModal, { type PreviewData } from '../../components/ConfigPreviewModal';

interface Baseline {
  backup_id: string;
  auto_remediate: boolean;
  set_by: string;
  set_at: string;
}

export default function BackupsTab({ deviceId, canOperate, canConfig, vendor }: {
  deviceId: string; canOperate: boolean; canConfig: boolean; vendor?: string;
}) {
  const { data: backups = [], refetch } = useApiQuery<any[]>(`/api/devices/${deviceId}/backups`);
  const { data: baseline = null, refetch: refetchBaseline } =
    useApiQuery<Baseline | null>(`/api/devices/${deviceId}/baseline`);
  const [diff, setDiff] = useState('');
  const [showBackup, setShowBackup] = useState(false);
  const [reason, setReason] = useState('');
  const [ticket, setTicket] = useState('');
  const [driftPreview, setDriftPreview] = useState<PreviewData | null>(null);
  const { run, busy, isBusy } = useAction();
  // Drift detection works on RouterOS, but a /export cannot be replayed, so
  // restore-from-baseline (and its dry run / auto-remediate) is Cisco-only.
  const isRos = vendor === 'mikrotik';

  const setBaseline = (backupId: string) => run(async () => {
    await api(`/api/devices/${deviceId}/baseline`, {
      method: 'PUT',
      // re-pointing the baseline keeps the existing auto-remediate choice
      body: { backupId, autoRemediate: (baseline?.auto_remediate ?? false) && !isRos }
    });
    refetchBaseline();
  }, { key: `baseline:${backupId}`, success: 'Baseline set. Drift sweeps now compare against this backup.' });

  const toggleAutoRemediate = () => {
    if (!baseline) return;
    run(async () => {
      await api(`/api/devices/${deviceId}/baseline`, {
        method: 'PUT', body: { backupId: baseline.backup_id, autoRemediate: !baseline.auto_remediate }
      });
      refetchBaseline();
    }, { key: 'auto-remediate' });
  };

  const dryRunDrift = () => run(async () => {
    setDriftPreview(await api(`/api/devices/${deviceId}/baseline/dry-run`, { method: 'POST' }));
  }, { key: 'drift-dry-run' });

  const restoreBaseline = () => {
    if (!baseline) return;
    run(async () => {
      await api(`/api/devices/${deviceId}/restore/${baseline.backup_id}`, { method: 'POST' });
      setDriftPreview(null);
      refetch();   // the pre-restore snapshot appears in the list
    }, { key: 'restore-baseline', success: 'Baseline restore pushed.' });
  };

  const takeBackup = () => run(async () => {
    await api(`/api/devices/${deviceId}/backups`, { method: 'POST', body: { reason, ticket } });
    setShowBackup(false); setReason(''); setTicket(''); refetch();
  });

  const showDiff = (backupId: string) => run(async () => {
    setDiff((await api(`/api/devices/${deviceId}/diff?from=${backupId}&to=live`)).diff);
  }, { key: `diff:${backupId}` });

  const restore = (backupId: string) => {
    if (!confirm('Replay this backup onto the device? A pre-restore backup is taken first.')) return;
    run(async () => {
      await api(`/api/devices/${deviceId}/restore/${backupId}`, { method: 'POST' });
      refetch();   // the pre-restore snapshot appears in the list
    }, { key: `restore:${backupId}`, success: 'Restore pushed.' });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Configuration backups">
        {canOperate && <Button onClick={() => setShowBackup(true)}>Backup now</Button>}
        <div className="overflow-x-auto">
        <table className="mt-3 w-full text-sm">
          <thead><tr className="border-b text-left text-xs uppercase text-gray-500 dark:text-slate-400">
            <th className="py-1">Taken</th><th>By</th><th>Reason</th><th>Ticket</th><th>Size</th><th></th></tr></thead>
          <tbody>
            {backups.map(b => (
              <tr key={b.id} className="border-b last:border-0">
                <td className="py-1.5">
                  {new Date(b.created_at).toLocaleString()}
                  {baseline?.backup_id === b.id && (
                    <span className="ml-1.5 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700 ring-1 ring-brand-200 dark:bg-brand-500/10 dark:text-brand-400 dark:ring-brand-500/30">baseline</span>
                  )}
                </td>
                <td>{b.taken_by}</td>
                <td className="max-w-32 truncate text-slate-600 dark:text-slate-400" title={b.reason || undefined}>{b.reason || '-'}</td>
                <td className="font-mono text-xs text-slate-600 dark:text-slate-400">{b.ticket || '-'}</td>
                <td>{(b.size / 1024).toFixed(1)} KB</td>
                <td className="space-x-2 text-right">
                  <button className="text-xs text-brand-600 hover:underline disabled:opacity-50 dark:text-brand-400"
                          disabled={busy} onClick={() => showDiff(b.id)}>
                    {isBusy(`diff:${b.id}`) ? 'diffing…' : 'diff vs live'}
                  </button>
                  {canConfig && baseline?.backup_id !== b.id && (
                    <button className="text-xs text-brand-600 hover:underline disabled:opacity-50 dark:text-brand-400"
                            disabled={busy} onClick={() => setBaseline(b.id)}>
                      {isBusy(`baseline:${b.id}`) ? 'setting…' : 'set baseline'}
                    </button>
                  )}
                  {canConfig && (
                    <button className="text-xs text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
                            disabled={busy} onClick={() => restore(b.id)}>
                      {isBusy(`restore:${b.id}`) ? 'restoring…' : 'restore'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {backups.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-gray-400 dark:text-slate-500">No backups yet</td></tr>}
          </tbody>
        </table>
        </div>
      </Card>
      <Card title="Diff">
        <pre className="max-h-[32rem] overflow-auto rounded bg-gray-900 p-3 text-xs leading-relaxed">
          {diff ? diff.split('\n').map((l, i) => (
            <div key={i} className={l.startsWith('+') ? 'text-green-400' : l.startsWith('-') ? 'text-red-400' : 'text-gray-300'}>{l}</div>
          )) : <span className="text-gray-400 dark:text-slate-500">Select “diff vs live” on a backup.</span>}
        </pre>
      </Card>

      <Card title="Baseline & drift">
        {!baseline ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No baseline set. Pick a known-good backup above and click <span className="font-medium">set baseline</span> —
            every drift sweep then compares the live config against it and raises a
            <span className="font-mono text-xs"> config_drift</span> alert when they diverge.
          </p>
        ) : (
          <div className="space-y-3 text-sm">
            <p className="text-slate-600 dark:text-slate-400">
              Baseline: <span className="font-medium text-slate-800 dark:text-slate-100">
                {(() => {
                  const b = backups.find(x => x.id === baseline.backup_id);
                  return b ? `backup from ${new Date(b.created_at).toLocaleString()}` : `backup ${String(baseline.backup_id).slice(0, 8)}…`;
                })()}
              </span>
              <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">
                set by {baseline.set_by} on {new Date(baseline.set_at).toLocaleDateString()}
              </span>
            </p>
            {isRos ? (
              <p className="text-xs text-slate-400 dark:text-slate-500">
                Drift detection is active. Restore/auto-remediation is unavailable on RouterOS
                (an /export cannot be replayed line by line) — reconcile drift on the device.
              </p>
            ) : (
              <>
                <label className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                  <input type="checkbox" checked={baseline.auto_remediate} disabled={!canConfig || busy}
                         onChange={toggleAutoRemediate} />
                  Auto-remediate: push the baseline back automatically when drift is detected
                </label>
                {canConfig && (
                  <div>
                    <Button variant="secondary" disabled={busy} onClick={dryRunDrift}>
                      {isBusy('drift-dry-run') ? 'Comparing…' : 'Preview restore (dry run)'}
                    </Button>
                    <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">
                      Shows exactly what a restore-to-baseline would push, against the live config. Changes nothing.
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Card>

      {driftPreview && (
        <ConfigPreviewModal
          title="Restore to baseline (dry run)"
          data={driftPreview}
          busy={isBusy('restore-baseline')}
          applyLabel="Restore baseline now"
          onApply={() => {
            if (confirm('Push the baseline config back onto the device? A pre-restore backup is taken first.')) restoreBaseline();
          }}
          onClose={() => setDriftPreview(null)}
        />
      )}

      {showBackup && (
        <Modal title="Take configuration backup" onClose={() => setShowBackup(false)}>
          <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
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
