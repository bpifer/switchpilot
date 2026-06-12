import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useApiQuery } from '../hooks/useApiQuery';
import { PageHeader, Card, StatusBadge, Modal, Button } from '../components/ui';
import { useWebSocket } from '../hooks/useWebSocket';

interface Job {
  id: string;
  name: string;
  type: string;
  status: string;
  device_ids: string[];
  created_by: string;
  schedule_at: string | null;
  finished_at: string | null;
  attempts: number;
  max_attempts: number;
  last_error: string;
  run_after: string | null;
  stage?: string;
}

interface JobResult {
  id: string;
  device_id: string;
  hostname: string | null;
  success: boolean;
  output: string;
  attempt: number;
  finished_at: string;
}

export default function Jobs() {
  const [detail, setDetail] = useState<(Job & { results: JobResult[] }) | null>(null);
  const [retrying, setRetrying] = useState('');
  const detailIdRef = useRef<string | null>(null);
  detailIdRef.current = detail?.id ?? null;

  const { data: jobs = [], refetch } = useApiQuery<Job[]>('/api/jobs', { refetchInterval: 30000 });
  const load = async () => { await refetch(); };
  const openDetail = (id: string) =>
    api<Job & { results: JobResult[] }>(`/api/jobs/${id}`).then(setDetail).catch(() => {});

  // Live updates: refresh the list (and the open detail) whenever a job advances.
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useWebSocket(msg => {
    if (msg.type !== 'job_progress') return;
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => {
      load();
      if (detailIdRef.current === msg.data.jobId) openDetail(msg.data.jobId);
    }, 400);
  });

  const retry = async (id: string) => {
    setRetrying(id);
    try {
      await api(`/api/jobs/${id}/retry`, { method: 'POST' });
      await load();
      if (detailIdRef.current === id) await openDetail(id);
    } catch { /* surfaced by 409 toast elsewhere */ } finally { setRetrying(''); }
  };

  const isActive = (s: string) => s === 'running' || s === 'pending';

  const clearFinished = async () => {
    if (!confirm('Remove all finished jobs (done, failed, cancelled) and their results? Running and pending jobs are kept.')) return;
    try { await api('/api/jobs/finished', { method: 'DELETE' }); await load(); }
    catch (err: any) { alert(err.message); }
  };

  return (
    <div>
      <PageHeader title="Jobs">
        <Button variant="secondary" onClick={clearFinished}>Clear finished</Button>
      </PageHeader>
      <div className="p-6">
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-slate-500">
                  <th className="py-2 pr-4">Status</th>
                  <th className="pr-4">Name</th>
                  <th className="pr-4">Type</th>
                  <th className="pr-4">Devices</th>
                  <th className="pr-4">Attempts</th>
                  <th className="pr-4">Created by</th>
                  <th className="pr-4">Scheduled</th>
                  <th className="pr-4">Finished</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {jobs.map(j => (
                  <tr key={j.id} className="cursor-pointer border-b last:border-0 hover:bg-slate-50"
                      onClick={() => openDetail(j.id)}>
                    <td className="py-2 pr-4">
                      <span className="inline-flex items-center gap-1.5">
                        <StatusBadge status={j.status} />
                        {j.status === 'running' && (
                          <svg className="h-3 w-3 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        )}
                      </span>
                    </td>
                    <td className="pr-4">
                      <div className="font-medium text-slate-800">{j.name}</div>
                      {j.status === 'running' && j.stage && (
                        <div className="mt-0.5 text-xs text-blue-600">{j.stage}</div>
                      )}
                    </td>
                    <td className="pr-4 text-slate-600">{j.type}</td>
                    <td className="pr-4 text-slate-600">{(j.device_ids ?? []).length}</td>
                    <td className="pr-4 text-slate-600">
                      {j.attempts}{j.max_attempts > 1 ? `/${j.max_attempts}` : ''}
                      {j.status === 'pending' && j.attempts > 0 && (
                        <span className="ml-1 text-xs text-amber-600">retry queued</span>
                      )}
                    </td>
                    <td className="pr-4 text-slate-600">{j.created_by}</td>
                    <td className="pr-4 text-slate-600">{j.schedule_at ? new Date(j.schedule_at).toLocaleString() : 'immediate'}</td>
                    <td className="pr-4 text-slate-600">{j.finished_at ? new Date(j.finished_at).toLocaleString() : '—'}</td>
                    <td className="pr-2 text-right" onClick={e => e.stopPropagation()}>
                      {j.status === 'failed' && (
                        <Button variant="secondary" onClick={() => retry(j.id)} disabled={retrying === j.id}>
                          {retrying === j.id ? 'Retrying…' : 'Retry'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {jobs.length === 0 && (
                  <tr><td colSpan={9} className="py-8 text-center text-slate-400">No jobs yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {detail && (
        <Modal title={`Job: ${detail.name}`} onClose={() => setDetail(null)}>
          <div className="mb-3 flex items-center gap-2 text-sm">
            <StatusBadge status={detail.status} />
            <span className="text-slate-600">{detail.type}</span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-600">attempt {detail.attempts}{detail.max_attempts > 1 ? ` of ${detail.max_attempts}` : ''}</span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-600">{detail.results?.length ?? 0} result(s)</span>
            {detail.status === 'failed' && (
              <span className="ml-auto">
                <Button variant="secondary" onClick={() => retry(detail.id)} disabled={retrying === detail.id}>
                  {retrying === detail.id ? 'Retrying…' : 'Retry failed'}
                </Button>
              </span>
            )}
          </div>

          {detail.status === 'running' && detail.stage && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {detail.stage}
            </div>
          )}
          {detail.last_error && detail.status === 'failed' && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {detail.last_error}
            </div>
          )}
          {detail.status === 'pending' && detail.run_after && new Date(detail.run_after) > new Date() && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Retry scheduled for {new Date(detail.run_after).toLocaleString()}
            </div>
          )}

          <div className="max-h-96 space-y-2 overflow-auto">
            {(detail.results ?? []).map(r => (
              <div key={r.id} className="rounded-lg border border-slate-200 p-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-800">{r.hostname ?? r.device_id}</span>
                  <span className="flex items-center gap-2">
                    {r.attempt > 1 && <span className="text-xs text-slate-400">attempt {r.attempt}</span>}
                    <StatusBadge status={r.success ? 'done' : 'failed'} />
                  </span>
                </div>
                {r.output && (
                  <pre className="mt-1 max-h-32 overflow-auto rounded bg-slate-900 p-2 text-xs text-slate-100">{r.output}</pre>
                )}
              </div>
            ))}
            {isActive(detail.status) && (detail.results?.length ?? 0) === 0 && (
              <p className="py-4 text-center text-xs text-slate-400">Waiting for results…</p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
