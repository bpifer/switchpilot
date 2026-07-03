import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, apiUpload } from '../api';
import { toast } from '../components/Toast';
import { useApiQuery } from '../hooks/useApiQuery';
import type { Me } from '../App';
import { PageHeader, Card, Button, Modal, Field, inputCls } from '../components/ui';

interface FirmwareImage {
  id: string;
  filename: string;
  family: string;
  version: string;
  md5: string;
  size_bytes: number;
  uploaded_by: string;
  created_at: string;
}

interface ComplianceRow {
  id: string;
  hostname: string;
  family: string;
  model: string;
  ios_version: string;
  target_version: string | null;
  compliant: boolean | null;
}

export default function Firmware({ me }: { me: Me }) {
  const canManage = me.role === 'superadmin' || me.role === 'netadmin';
  const { data: images = [], refetch: refetchImages } = useApiQuery<FirmwareImage[]>('/api/firmware');
  const { data: report = [], refetch: refetchReport } = useApiQuery<ComplianceRow[]>('/api/firmware/compliance');
  const [showUpload, setShowUpload] = useState(false);
  const [upgrading, setUpgrading] = useState<FirmwareImage | null>(null);
  const [settingTarget, setSettingTarget] = useState<string | null>(null); // family

  const families = [...new Set(report.map(r => r.family).filter(Boolean))].sort();

  return (
    <div>
      <PageHeader title="Firmware">
        {canManage && <Button onClick={() => setShowUpload(true)}>Upload image</Button>}
      </PageHeader>

      <div className="space-y-4 p-6">
        <Card title="Device firmware">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-gray-500">
                <th className="py-1.5 pr-3">Device</th>
                <th className="pr-3">Model</th>
                <th className="pr-3">Family</th>
                <th className="pr-3">Running version</th>
                <th className="pr-3">Target version</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {report.map(d => (
                <tr key={d.id} className="border-b last:border-0">
                  <td className="py-2 pr-3">
                    <Link to={`/devices/${d.id}`} className="font-medium text-brand-600 hover:underline">
                      {d.hostname}
                    </Link>
                  </td>
                  <td className="pr-3 font-mono text-xs text-slate-600">{d.model || '-'}</td>
                  <td className="pr-3 text-xs text-slate-500">{d.family || '-'}</td>
                  <td className="pr-3 font-mono text-xs">{d.ios_version || '-'}</td>
                  <td className="pr-3 font-mono text-xs">
                    {d.target_version || <span className="text-slate-300">not set</span>}
                    {canManage && d.family && (
                      <button className="ml-2 text-xs text-brand-600 hover:underline"
                              onClick={() => setSettingTarget(d.family)}>
                        {d.target_version ? 'change' : 'set'}
                      </button>
                    )}
                  </td>
                  <td>
                    {d.target_version === null ? (
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">no target</span>
                    ) : d.compliant ? (
                      <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">compliant</span>
                    ) : (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">needs upgrade</span>
                    )}
                  </td>
                </tr>
              ))}
              {report.length === 0 && (
                <tr><td colSpan={6} className="py-6 text-center text-gray-400">No devices yet</td></tr>
              )}
            </tbody>
          </table>
          </div>
        </Card>

        <Card title="Image library">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-gray-500">
                <th className="py-1.5 pr-3">Filename</th>
                <th className="pr-3">Family</th>
                <th className="pr-3">Version</th>
                <th className="pr-3">Size</th>
                <th className="pr-3">MD5</th>
                <th className="pr-3">Uploaded</th>
                {canManage && <th></th>}
              </tr>
            </thead>
            <tbody>
              {images.map(img => (
                <tr key={img.id} className="border-b last:border-0">
                  <td className="py-2 pr-3 font-mono text-xs">{img.filename}</td>
                  <td className="pr-3 text-xs text-slate-500">{img.family}</td>
                  <td className="pr-3 font-mono text-xs">{img.version}</td>
                  <td className="pr-3 text-xs">{(img.size_bytes / 1024 / 1024).toFixed(1)} MB</td>
                  <td className="pr-3 font-mono text-[10px] text-slate-400" title={img.md5}>{img.md5.slice(0, 12)}…</td>
                  <td className="pr-3 text-xs text-slate-500">{new Date(img.created_at).toLocaleDateString()} by {img.uploaded_by}</td>
                  {canManage && (
                    <td className="space-x-3 text-right">
                      <Button variant="secondary" onClick={() => setUpgrading(img)}>Upgrade devices…</Button>
                      <button className="text-xs text-red-600 hover:underline"
                              onClick={async () => {
                                if (!confirm(`Delete ${img.filename} from SwitchPilot? Switches that already copied it are unaffected.`)) return;
                                try { await api(`/api/firmware/${img.id}`, { method: 'DELETE' }); refetchImages(); }
                                catch (err: any) { toast.error(err.message); }
                              }}>
                        delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {images.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 7 : 6} className="py-6 text-center text-gray-400">
                    No firmware images uploaded yet{canManage ? ' - use "Upload image" above' : ''}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </Card>
      </div>

      {showUpload && (
        <UploadModal families={families} onClose={() => setShowUpload(false)}
          onDone={() => { setShowUpload(false); refetchImages(); }} />
      )}
      {upgrading && (
        <UpgradeModal image={upgrading} onClose={() => setUpgrading(null)}
          onDone={() => setUpgrading(null)} />
      )}
      {settingTarget && (
        <TargetModal family={settingTarget} images={images}
          current={report.find(r => r.family === settingTarget)?.target_version ?? ''}
          onClose={() => setSettingTarget(null)}
          onDone={() => { setSettingTarget(null); refetchReport(); }} />
      )}
    </div>
  );
}

function UploadModal({ families, onClose, onDone }: {
  families: string[]; onClose: () => void; onDone: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [family, setFamily] = useState('');
  const [version, setVersion] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file || !family.trim() || !version.trim()) {
      setError('File, family, and version are all required.');
      return;
    }
    setBusy(true); setError(''); setProgress(`Uploading ${file.name} (${(file.size / 1024 / 1024).toFixed(0)} MB)…`);
    try {
      const form = new FormData();
      // field order matters: @fastify/multipart reads fields that precede the file
      form.append('family', family.trim());
      form.append('version', version.trim());
      form.append('file', file);
      await apiUpload('/api/firmware', form);
      onDone();
    } catch (err: any) {
      setError(err.message);
      setProgress('');
    } finally { setBusy(false); }
  }

  return (
    <Modal title="Upload firmware image" onClose={onClose}>
      <p className="mb-3 text-sm text-slate-500">
        Upload an IOS image (.bin). The MD5 is computed server-side and verified on the switch after copy.
      </p>
      <Field label="Image file">
        <input ref={fileRef} type="file" accept=".bin,.tar,.pkg" className="block w-full text-sm" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Device family">
          <input className={inputCls} value={family} onChange={e => setFamily(e.target.value)}
                 list="fw-families" placeholder="e.g. c2960x" />
          <datalist id="fw-families">
            {families.map(f => <option key={f} value={f} />)}
          </datalist>
        </Field>
        <Field label="Version">
          <input className={inputCls} value={version} onChange={e => setVersion(e.target.value)}
                 placeholder="e.g. 15.2(7)E10" />
        </Field>
      </div>
      {progress && !error && <p className="mb-2 text-sm text-brand-600">{progress}</p>}
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={upload} disabled={busy}>{busy ? 'Uploading…' : 'Upload'}</Button>
      </div>
    </Modal>
  );
}

function UpgradeModal({ image, onClose, onDone }: {
  image: FirmwareImage; onClose: () => void; onDone: () => void;
}) {
  // Only devices in the image's family can take this image (backend enforces too)
  const { data: devices = [] } = useApiQuery<any[]>('/api/devices');
  const eligible = devices.filter(d => d.family === image.family);
  const [selected, setSelected] = useState<string[]>([]);
  const [scheduleAt, setScheduleAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const toggle = (id: string) =>
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  async function start() {
    if (selected.length === 0) return;
    setBusy(true); setError('');
    try {
      await api(`/api/firmware/${image.id}/upgrade`, {
        method: 'POST',
        body: {
          deviceIds: selected,
          ...(scheduleAt ? { scheduleAt: new Date(scheduleAt).toISOString() } : {})
        }
      });
      onDone();
      // The upgrade runs as a job - take the user to where they can watch it
      navigate('/jobs');
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={`Upgrade to ${image.version}`} onClose={onClose}>
      <p className="mb-3 text-sm text-slate-500">
        The switch copies <span className="font-mono text-xs">{image.filename}</span> from this platform over HTTP,
        verifies the MD5, sets the boot statement, and reloads. The device will be down for several minutes during the reload.
      </p>

      <div className="mb-3 max-h-60 overflow-auto rounded border border-slate-200">
        {eligible.map(d => (
          <label key={d.id} className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-0 hover:bg-slate-50">
            <input type="checkbox" className="rounded border-slate-300"
                   checked={selected.includes(d.id)} onChange={() => toggle(d.id)} />
            <span className="font-medium">{d.hostname}</span>
            <span className="font-mono text-xs text-slate-400">{d.ios_version}</span>
            <span className={`ml-auto text-xs ${d.status === 'online' ? 'text-green-600' : 'text-red-500'}`}>{d.status}</span>
          </label>
        ))}
        {eligible.length === 0 && (
          <p className="px-3 py-4 text-center text-sm text-slate-400">
            No devices in family "{image.family}".
          </p>
        )}
      </div>

      <Field label="Schedule (optional - leave blank to run now)">
        <input className={inputCls} type="datetime-local" value={scheduleAt}
               onChange={e => setScheduleAt(e.target.value)} />
      </Field>

      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400">{selected.length} device{selected.length !== 1 ? 's' : ''} selected</span>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={start} disabled={busy || selected.length === 0}>
            {busy ? 'Creating job…' : scheduleAt ? 'Schedule upgrade' : 'Upgrade now'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function TargetModal({ family, images, current, onClose, onDone }: {
  family: string; images: FirmwareImage[]; current: string; onClose: () => void; onDone: () => void;
}) {
  const familyVersions = [...new Set(images.filter(i => i.family === family).map(i => i.version))];
  const [version, setVersion] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    if (!version.trim()) return;
    setBusy(true); setError('');
    try {
      await api(`/api/firmware/compliance/${encodeURIComponent(family)}`, {
        method: 'PUT', body: { targetVersion: version.trim() }
      });
      onDone();
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={`Target version for ${family}`} onClose={onClose}>
      <p className="mb-3 text-sm text-slate-500">
        Devices in this family running a different version show as "needs upgrade" on this page and in compliance reports.
      </p>
      <Field label="Target version">
        <input className={inputCls} value={version} onChange={e => setVersion(e.target.value)}
               list="fw-versions" placeholder="e.g. 15.2(7)E10" autoFocus />
        <datalist id="fw-versions">
          {familyVersions.map(v => <option key={v} value={v} />)}
        </datalist>
      </Field>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={save} disabled={busy || !version.trim()}>{busy ? 'Saving…' : 'Save'}</Button>
      </div>
    </Modal>
  );
}
