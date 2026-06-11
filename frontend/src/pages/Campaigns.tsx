import { useEffect, useState } from 'react';
import { api } from '../api';
import { PageHeader, Card, Button } from '../components/ui';

interface Campaign {
  id: string;
  name: string;
  status: 'draft' | 'running' | 'paused' | 'completed' | 'aborted';
  rings: string[];
  wait_days: number;
  current_ring: string;
  ring_started_at: string | null;
  created_by: string;
  created_at: string;
  image_filename: string | null;
  image_version: string | null;
  image_family: string | null;
  succeeded: number;
  failed: number;
  total: number;
}

interface FirmwareImage {
  id: string;
  filename: string;
  version: string;
  family: string;
}

interface RingCount {
  pilot: number;
  production: number;
  critical: number;
}

const STATUS_COLOR: Record<Campaign['status'], string> = {
  draft:     'bg-slate-100 text-slate-600',
  running:   'bg-blue-100 text-blue-700',
  paused:    'bg-amber-100 text-amber-700',
  completed: 'bg-green-100 text-green-700',
  aborted:   'bg-red-100 text-red-700',
};

const RING_COLOR: Record<string, string> = {
  pilot:      'bg-violet-100 text-violet-700',
  production: 'bg-blue-100 text-blue-700',
  critical:   'bg-red-100 text-red-700',
};

function daysElapsed(since: string | null): number | null {
  if (!since) return null;
  return Math.floor((Date.now() - new Date(since).getTime()) / 86_400_000);
}

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [images, setImages] = useState<FirmwareImage[]>([]);
  const [ringCounts, setRingCounts] = useState<Partial<RingCount>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', imageId: '', rings: ['pilot', 'production'] as string[], waitDays: 7 });
  const [busy, setBusy] = useState('');

  const load = () => {
    setLoading(true);
    Promise.all([
      api<Campaign[]>('/api/campaigns'),
      api<FirmwareImage[]>('/api/firmware')
    ]).then(([c, imgs]) => {
      setCampaigns(c);
      setImages(imgs);
    }).catch(() => {}).finally(() => setLoading(false));

    // get ring counts from a campaign detail if available
    api<any>('/api/campaigns').then((cs: Campaign[]) => {
      if (cs[0]) api<any>(`/api/campaigns/${cs[0].id}`).then((d: any) => {
        setRingCounts(d.ring_counts ?? {});
      }).catch(() => {});
    }).catch(() => {});
  };

  useEffect(load, []);

  const act = async (url: string, method = 'POST') => {
    setBusy(url);
    try { await api(url, { method }); load(); } catch { /* handled */ } finally { setBusy(''); }
  };

  const create = async () => {
    if (!form.name.trim() || !form.imageId) return;
    setBusy('create');
    try {
      await api('/api/campaigns', {
        method: 'POST',
        body: JSON.stringify({ name: form.name, imageId: form.imageId, rings: form.rings, waitDays: form.waitDays })
      });
      setShowCreate(false);
      setForm({ name: '', imageId: '', rings: ['pilot', 'production'], waitDays: 7 });
      load();
    } catch { /* handled */ } finally { setBusy(''); }
  };

  const toggleRing = (r: string) => setForm(f => ({
    ...f,
    rings: f.rings.includes(r) ? f.rings.filter(x => x !== r) : [...f.rings, r]
  }));

  return (
    <div>
      <PageHeader title="Firmware Campaigns">
        <Button variant="primary" onClick={() => setShowCreate(true)}>New Campaign</Button>
      </PageHeader>

      <div className="px-6 py-4 space-y-4">
        {/* Ring inventory */}
        <div className="grid grid-cols-3 gap-4">
          {(['pilot', 'production', 'critical'] as const).map(r => (
            <Card key={r}>
              <div className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide mb-2 ${RING_COLOR[r]}`}>
                {r}
              </div>
              <div className="text-2xl font-bold text-slate-800">{(ringCounts as any)[r] ?? '—'}</div>
              <div className="text-xs text-slate-400">switch{((ringCounts as any)[r] ?? 0) !== 1 ? 'es' : ''} assigned</div>
            </Card>
          ))}
        </div>

        {/* Campaign list */}
        {loading ? (
          <p className="text-sm text-slate-400 py-4">Loading campaigns…</p>
        ) : campaigns.length === 0 ? (
          <Card>
            <p className="text-sm text-slate-400 py-8 text-center">No campaigns yet. Create one to stage a firmware rollout.</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {campaigns.map(c => {
              const elapsed = daysElapsed(c.ring_started_at);
              const pct = c.total ? Math.round((c.succeeded + c.failed) / c.total * 100) : 0;
              return (
                <Card key={c.id}>
                  <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${STATUS_COLOR[c.status]}`}>
                          {c.status}
                        </span>
                        <h3 className="font-semibold text-slate-800 truncate">{c.name}</h3>
                      </div>
                      <div className="text-xs text-slate-500 mb-3">
                        {c.image_family && <span className="mr-3">Family: <strong>{c.image_family}</strong></span>}
                        {c.image_version && <span className="mr-3">Target: <strong className="font-mono">{c.image_version}</strong></span>}
                        <span>Wait: <strong>{c.wait_days}d between rings</strong></span>
                      </div>

                      {/* Ring progress */}
                      <div className="flex items-center gap-2 mb-3">
                        {c.rings.map((r, idx) => (
                          <div key={r} className="flex items-center gap-1">
                            {idx > 0 && <div className="w-6 h-px bg-slate-300" />}
                            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              c.current_ring === r && c.status === 'running'
                                ? RING_COLOR[r] + ' ring-2 ring-offset-1 ring-current'
                                : c.rings.indexOf(c.current_ring) > idx
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-slate-100 text-slate-400'
                            }`}>
                              {r}
                            </span>
                          </div>
                        ))}
                      </div>

                      {c.total > 0 && (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div className="flex h-full">
                              <div className="bg-green-500 h-full" style={{ width: `${c.total ? c.succeeded / c.total * 100 : 0}%` }} />
                              <div className="bg-red-500 h-full" style={{ width: `${c.total ? c.failed / c.total * 100 : 0}%` }} />
                            </div>
                          </div>
                          <span className="text-xs text-slate-500 shrink-0">
                            {c.succeeded}/{c.total} succeeded{c.failed > 0 && `, ${c.failed} failed`}
                          </span>
                        </div>
                      )}

                      {elapsed !== null && c.status === 'running' && (
                        <p className="text-xs text-slate-400 mt-2">
                          Current ring started {elapsed}d ago
                          {elapsed >= c.wait_days && (
                            <span className="ml-1 text-amber-600 font-medium">— ready to advance</span>
                          )}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-1.5 shrink-0">
                      {c.status === 'draft' && (
                        <Button variant="primary" onClick={() => act(`/api/campaigns/${c.id}/start`)}
                          disabled={!!busy}>
                          Start
                        </Button>
                      )}
                      {c.status === 'running' && (
                        <>
                          <Button variant="primary" onClick={() => act(`/api/campaigns/${c.id}/advance`)}
                            disabled={!!busy}>
                            Advance
                          </Button>
                          <Button variant="secondary" onClick={() => act(`/api/campaigns/${c.id}/pause`)}
                            disabled={!!busy}>
                            Pause
                          </Button>
                        </>
                      )}
                      {c.status === 'paused' && (
                        <Button variant="primary" onClick={() => act(`/api/campaigns/${c.id}/advance`)}
                          disabled={!!busy}>
                          Resume
                        </Button>
                      )}
                      {(c.status === 'running' || c.status === 'paused') && (
                        <Button variant="danger" onClick={() => act(`/api/campaigns/${c.id}/abort`)}
                          disabled={!!busy}>
                          Abort
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* Create modal */}
        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
              <h2 className="text-base font-semibold text-slate-800 mb-4">New Firmware Campaign</h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Campaign name</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Q1 2025 Catalyst 9300 Upgrade"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Firmware image</label>
                  <select
                    value={form.imageId}
                    onChange={e => setForm(f => ({ ...f, imageId: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-brand-500"
                  >
                    <option value="">— select image —</option>
                    {images.map(img => (
                      <option key={img.id} value={img.id}>{img.family} — {img.version} ({img.filename})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-2">Deployment rings (in order)</label>
                  <div className="flex gap-2">
                    {(['pilot', 'production', 'critical'] as const).map(r => (
                      <label key={r} className="flex items-center gap-1.5 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.rings.includes(r)}
                          onChange={() => toggleRing(r)}
                          className="rounded border-slate-300"
                        />
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${RING_COLOR[r]}`}>{r}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Wait days between rings</label>
                  <input
                    type="number"
                    min={0}
                    max={90}
                    value={form.waitDays}
                    onChange={e => setForm(f => ({ ...f, waitDays: parseInt(e.target.value) || 0 }))}
                    className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-brand-500"
                  />
                  <span className="ml-2 text-xs text-slate-400">0 = advance manually only</span>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button variant="primary" onClick={create} disabled={busy === 'create'}>
                  {busy === 'create' ? 'Creating…' : 'Create Campaign'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
