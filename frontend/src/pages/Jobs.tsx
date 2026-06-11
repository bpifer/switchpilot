import { useEffect, useState } from 'react';
import { api } from '../api';
import { PageHeader, Card, StatusBadge, Modal } from '../components/ui';

export default function Jobs() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [detail, setDetail] = useState<any | null>(null);

  const load = () => api('/api/jobs').then(setJobs).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);

  return (
    <div>
      <PageHeader title="Jobs" />
      <div className="p-6">
        <Card>
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs uppercase text-gray-500">
              <th className="py-2">Status</th><th>Name</th><th>Type</th><th>Devices</th><th>Created by</th><th>Scheduled</th><th>Finished</th></tr></thead>
            <tbody>
              {jobs.map(j => (
                <tr key={j.id} className="cursor-pointer border-b last:border-0 hover:bg-gray-50"
                    onClick={() => api(`/api/jobs/${j.id}`).then(setDetail)}>
                  <td className="py-2"><StatusBadge status={j.status} /></td>
                  <td className="font-medium">{j.name}</td>
                  <td>{j.type}</td>
                  <td>{(j.device_ids ?? []).length}</td>
                  <td>{j.created_by}</td>
                  <td>{j.schedule_at ? new Date(j.schedule_at).toLocaleString() : 'immediate'}</td>
                  <td>{j.finished_at ? new Date(j.finished_at).toLocaleString() : '—'}</td>
                </tr>
              ))}
              {jobs.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-gray-400">No jobs yet</td></tr>}
            </tbody>
          </table>
        </Card>
      </div>
      {detail && (
        <Modal title={`Job: ${detail.name}`} onClose={() => setDetail(null)}>
          <div className="mb-3 text-sm"><StatusBadge status={detail.status} /> {detail.type} — {detail.results?.length ?? 0} result(s)</div>
          <div className="max-h-96 space-y-2 overflow-auto">
            {(detail.results ?? []).map((r: any) => (
              <div key={r.id} className="rounded border p-2 text-sm">
                <div className="flex justify-between">
                  <span className="font-medium">{r.hostname ?? r.device_id}</span>
                  <StatusBadge status={r.success ? 'done' : 'failed'} />
                </div>
                {r.output && <pre className="mt-1 max-h-32 overflow-auto rounded bg-gray-900 p-2 text-xs text-gray-100">{r.output}</pre>}
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
