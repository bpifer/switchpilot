// Shows a dry-run config diff (new / present / removes) plus the backend's
// guardrail warnings, with an Apply button. Reused by the Config tab and the
// compliance remediation flow so every config push gets the same safety net.
import { Modal, Button } from './ui';

export interface PreviewLine { line: string; status: string; note: string }
export interface PreviewData {
  lines: PreviewLine[];
  warnings: string[];
  summary: { new: number; present: number; removes: number };
}

export default function ConfigPreviewModal({
  title = 'Preview changes', data, busy, applyLabel = 'Apply', onApply, onClose,
}: {
  title?: string; data: PreviewData; busy: boolean;
  applyLabel?: string; onApply: () => void; onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      {data.warnings.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <div className="text-sm font-medium text-amber-800">⚠ Review before applying</div>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-amber-700">
            {data.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}
      <p className="mb-3 text-sm text-slate-500">
        Compared against the live running config. Nothing has been changed yet.
        <span className="ml-1 font-medium text-slate-700">
          {data.summary.new} new, {data.summary.present} already present
          {data.summary.removes > 0 ? `, ${data.summary.removes} removed` : ''}.
        </span>
      </p>
      <div className="max-h-72 space-y-1 overflow-auto rounded-lg bg-gray-900 p-3 font-mono text-xs">
        {data.lines.map((l, i) => (
          <div key={i} className={
            l.status === 'new' ? 'text-green-400'
            : l.status === 'removes' ? 'text-red-400'
            : l.status === 'present' ? 'text-slate-500'
            : 'text-cyan-400'}>
            <span className="inline-block w-16 select-none text-[10px] uppercase opacity-60">{l.status}</span>
            {l.line}
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={onApply} disabled={busy}>{busy ? 'Applying…' : applyLabel}</Button>
      </div>
    </Modal>
  );
}
