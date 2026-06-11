import { useEffect, useState } from 'react';
import { api } from '../api';
import { PageHeader, Card, Button, Modal } from '../components/ui';

interface Window { id: string; name: string; device_ids: string[]; starts_at: string; ends_at: string; created_by: string; }

const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 transition';

const blank = { name: '', startsAt: '', endsAt: '', deviceIds: '' };

function isActive(w: Window) {
  return Date.now() >= new Date(w.starts_at).getTime() && Date.now() <= new Date(w.ends_at).getTime();
}
function isUpcoming(w: Window) {
  return new Date(w.starts_at).getTime() > Date.now();
}

export default function Maintenance() {
  const [windows, setWindows] = useState<Window[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function load() {
    api<Window[]>('/api/maintenance').then(setWindows).catch(() => {});
  }
  useEffect(load, []);

  async function save() {
    setSaving(true); setError('');
    try {
      const deviceIds = form.deviceIds
        ? form.deviceIds.split(',').map(s => s.trim()).filter(Boolean)
        : [];
      await api('/api/maintenance', {
        method: 'POST',
        body: JSON.stringify({ name: form.name, startsAt: form.startsAt, endsAt: form.endsAt, deviceIds })
      });
      setShowForm(false); setForm(blank); load();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save');
    } finally { setSaving(false); }
  }

  async function del(id: string) {
    if (!confirm('Delete this maintenance window?')) return;
    await api(`/api/maintenance/${id}`, { method: 'DELETE' }).catch(() => {});
    load();
  }

  return (
    <div>
      <PageHeader title="Maintenance Windows">
        <Button onClick={() => setShowForm(true)}>Schedule window</Button>
      </PageHeader>

      <div className="px-6 pb-6">
        <Card>
          {windows.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-400">
              No maintenance windows. Schedule one to suppress alerts during planned outages.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left">
                    <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Name</th>
                    <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                    <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Starts</th>
                    <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Ends</th>
                    <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Scope</th>
                    <th className="pb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">By</th>
                    <th className="pb-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {windows.map(w => (
                    <tr key={w.id} className="hover:bg-slate-50/80 transition">
                      <td className="py-3 pr-4 font-medium text-slate-800">{w.name}</td>
                      <td className="py-3 pr-4">
                        {isActive(w) ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-green-200">
                            <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                            Active
                          </span>
                        ) : isUpcoming(w) ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-blue-200">Upcoming</span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500 ring-1 ring-slate-200">Expired</span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-xs text-slate-600">{new Date(w.starts_at).toLocaleString()}</td>
                      <td className="py-3 pr-4 text-xs text-slate-600">{new Date(w.ends_at).toLocaleString()}</td>
                      <td className="py-3 pr-4 text-xs text-slate-500">
                        {w.device_ids.length === 0 ? 'All devices' : `${w.device_ids.length} device(s)`}
                      </td>
                      <td className="py-3 pr-4 text-xs text-slate-500">{w.created_by}</td>
                      <td className="py-3 text-right">
                        <button onClick={() => del(w.id)} className="text-xs text-red-500 hover:text-red-700 transition">Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {showForm && (
        <Modal title="Schedule Maintenance Window" onClose={() => setShowForm(false)}>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Name</label>
              <input className={inputCls} placeholder="e.g. Core switch stack reboot" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Starts at</label>
                <input type="datetime-local" className={inputCls} value={form.startsAt}
                  onChange={e => setForm(f => ({ ...f, startsAt: e.target.value }))} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Ends at</label>
                <input type="datetime-local" className={inputCls} value={form.endsAt}
                  onChange={e => setForm(f => ({ ...f, endsAt: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Device IDs (optional)</label>
              <input className={inputCls} placeholder="Leave blank to suppress ALL devices — or paste comma-separated UUIDs"
                value={form.deviceIds} onChange={e => setForm(f => ({ ...f, deviceIds: e.target.value }))} />
              <p className="mt-1 text-xs text-slate-400">Leave blank to suppress alerts for all devices during this window.</p>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button onClick={save} disabled={saving || !form.name || !form.startsAt || !form.endsAt}>
                {saving ? 'Saving…' : 'Schedule'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
