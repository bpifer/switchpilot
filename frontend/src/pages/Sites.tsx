import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useApiQuery } from '../hooks/useApiQuery';
import type { Me } from '../App';
import { useSiteScope } from '../context/SiteContext';
import { PageHeader, Card, Button, Modal, Field, inputCls } from '../components/ui';

interface Site { id: string; name: string; address: string }

export default function Sites({ me }: { me: Me }) {
  const canEdit = me.role === 'superadmin' || me.role === 'netadmin';
  const { setSiteId } = useSiteScope();
  const { data: sites = [], refetch } = useApiQuery<Site[]>('/api/sites');
  // unscoped device list to count per-site membership
  const { data: devices = [] } = useApiQuery<any[]>('/api/devices');
  const [editing, setEditing] = useState<Partial<Site> | null>(null);
  const [error, setError] = useState('');

  const countFor = (id: string) => devices.filter(d => d.site_id === id).length;
  const unassigned = devices.filter(d => !d.site_id).length;

  async function save() {
    if (!editing?.name?.trim()) return;
    setError('');
    try {
      const body = { name: editing.name.trim(), address: editing.address ?? '' };
      if (editing.id) await api(`/api/sites/${editing.id}`, { method: 'PUT', body });
      else await api('/api/sites', { method: 'POST', body });
      setEditing(null); refetch();
    } catch (err: any) { setError(err.message); }
  }

  async function remove(s: Site) {
    if (!confirm(`Delete site "${s.name}"?`)) return;
    setError('');
    try { await api(`/api/sites/${s.id}`, { method: 'DELETE' }); refetch(); }
    catch (err: any) { setError(err.message); }
  }

  return (
    <div>
      <PageHeader title="Sites">
        {canEdit && <Button onClick={() => setEditing({ name: '', address: '' })}>Add site</Button>}
      </PageHeader>

      <div className="p-6">
        {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20">{error}</div>}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sites.map(s => (
            <Card key={s.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold text-slate-800 dark:text-slate-100">{s.name}</div>
                  {s.address && <div className="mt-0.5 truncate text-xs text-slate-400 dark:text-slate-500">{s.address}</div>}
                </div>
                {canEdit && (
                  <div className="flex shrink-0 gap-2 text-xs">
                    <button className="text-brand-600 hover:underline dark:text-brand-400" onClick={() => setEditing({ ...s })}>edit</button>
                    <button className="text-red-600 hover:underline dark:text-red-400" onClick={() => remove(s)}>delete</button>
                  </div>
                )}
              </div>
              <div className="mt-3 flex items-end justify-between">
                <div>
                  <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{countFor(s.id)}</div>
                  <div className="text-xs text-slate-400 dark:text-slate-500">switch{countFor(s.id) !== 1 ? 'es' : ''}</div>
                </div>
                <Link
                  to="/devices"
                  onClick={() => setSiteId(s.id)}
                  className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800/50"
                >
                  View devices →
                </Link>
              </div>
            </Card>
          ))}

          {/* Unassigned pseudo-site */}
          <Card className="border-dashed">
            <div className="text-base font-semibold text-slate-500 dark:text-slate-400">Unassigned</div>
            <div className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">Devices not yet placed in a site</div>
            <div className="mt-3 flex items-end justify-between">
              <div>
                <div className="text-2xl font-bold text-slate-700 dark:text-slate-300">{unassigned}</div>
                <div className="text-xs text-slate-400 dark:text-slate-500">switch{unassigned !== 1 ? 'es' : ''}</div>
              </div>
              <Link
                to="/devices"
                onClick={() => setSiteId('unassigned')}
                className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800/50"
              >
                View devices →
              </Link>
            </div>
          </Card>
        </div>

        {sites.length === 0 && (
          <p className="mt-6 text-center text-sm text-slate-400 dark:text-slate-500">
            No sites yet. {canEdit ? 'Add one to group devices by location.' : ''}
          </p>
        )}
      </div>

      {editing && (
        <Modal title={editing.id ? 'Edit site' : 'New site'} onClose={() => setEditing(null)}>
          <Field label="Name">
            <input className={inputCls} value={editing.name ?? ''}
                   onChange={e => setEditing(p => ({ ...p, name: e.target.value }))}
                   placeholder="e.g. HQ - Building A" autoFocus />
          </Field>
          <Field label="Address">
            <input className={inputCls} value={editing.address ?? ''}
                   onChange={e => setEditing(p => ({ ...p, address: e.target.value }))} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={!editing.name?.trim()}>Save</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
