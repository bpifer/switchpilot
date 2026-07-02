import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BackupsTab from '../device/BackupsTab';
import { api } from '../../api';
import { toast } from '../../components/Toast';

vi.mock('../../api', () => ({ api: vi.fn(), getToken: vi.fn(() => 'tok'), setToken: vi.fn() }));
vi.mock('../../components/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// Two backups; b1 is the pinned baseline. refetch spies let tests assert reloads.
const backups = [
  { id: 'b1', created_at: '2026-06-30T10:00:00Z', taken_by: 'admin', reason: 'golden', ticket: '', size: 20480 },
  { id: 'b2', created_at: '2026-07-01T10:00:00Z', taken_by: 'scheduler', reason: '', ticket: '', size: 20992 },
];
let baseline: any = { backup_id: 'b1', auto_remediate: false, set_by: 'admin', set_at: '2026-06-30T11:00:00Z' };
const refetchBackups = vi.fn();
const refetchBaseline = vi.fn();

vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn((path: string) =>
    path.endsWith('/baseline')
      ? { data: baseline, refetch: refetchBaseline }
      : { data: backups, refetch: refetchBackups }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  baseline = { backup_id: 'b1', auto_remediate: false, set_by: 'admin', set_at: '2026-06-30T11:00:00Z' };
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());

const renderTab = (vendor?: string) =>
  render(<BackupsTab deviceId="dev1" canOperate={true} canConfig={true} vendor={vendor} />);

describe('BackupsTab baseline management', () => {
  it('marks the baseline backup and offers "set baseline" only on the others', () => {
    renderTab();
    expect(screen.getByText('baseline')).toBeInTheDocument();
    // one non-baseline row -> exactly one "set baseline" action
    expect(screen.getAllByRole('button', { name: /set baseline/i })).toHaveLength(1);
    expect(screen.getByText(/set by admin/i)).toBeInTheDocument();
  });

  it('"set baseline" PUTs the backup id and keeps the auto-remediate choice', async () => {
    vi.mocked(api).mockResolvedValue({ ok: true });
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: /set baseline/i }));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/api/devices/dev1/baseline', {
      method: 'PUT', body: { backupId: 'b2', autoRemediate: false }
    }));
    expect(toast.success).toHaveBeenCalled();
    expect(refetchBaseline).toHaveBeenCalled();
  });

  it('toggling auto-remediate PUTs the flipped flag for the current baseline', async () => {
    vi.mocked(api).mockResolvedValue({ ok: true });
    renderTab();
    await userEvent.click(screen.getByRole('checkbox', { name: /auto-remediate/i }));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/api/devices/dev1/baseline', {
      method: 'PUT', body: { backupId: 'b1', autoRemediate: true }
    }));
  });

  it('dry run opens the preview modal with a restore action', async () => {
    vi.mocked(api).mockResolvedValue({
      lines: [{ line: 'ntp server 10.0.0.1', status: 'new', note: 'will be added' }],
      warnings: [], summary: { new: 1, present: 0, removes: 0 },
    });
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: /preview restore/i }));
    expect(await screen.findByText(/restore to baseline \(dry run\)/i)).toBeInTheDocument();
    expect(screen.getByText('ntp server 10.0.0.1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /restore baseline now/i })).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith('/api/devices/dev1/baseline/dry-run', { method: 'POST' });
  });

  it('RouterOS keeps drift detection but hides restore/auto-remediate (an /export is not replayable)', () => {
    renderTab('mikrotik');
    expect(screen.getByText(/drift detection is active/i)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /auto-remediate/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /preview restore/i })).not.toBeInTheDocument();
  });

  it('explains how to set a baseline when none exists', () => {
    baseline = null;
    renderTab();
    expect(screen.getByText(/no baseline set/i)).toBeInTheDocument();
  });
});

describe('BackupsTab restore error handling (regression: failures used to be silent)', () => {
  it('a failed restore surfaces the error as a toast', async () => {
    vi.mocked(api).mockRejectedValue(new Error('Device unreachable'));
    renderTab();
    await userEvent.click(screen.getAllByRole('button', { name: /^restore$/i })[0]);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Device unreachable'));
  });

  it('a successful restore toasts and refetches so the pre-restore snapshot appears', async () => {
    vi.mocked(api).mockResolvedValue({ ok: true });
    renderTab();
    await userEvent.click(screen.getAllByRole('button', { name: /^restore$/i })[0]);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Restore pushed.'));
    expect(refetchBackups).toHaveBeenCalled();
  });

  it('declining the confirm dialog does not touch the device', async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    renderTab();
    await userEvent.click(screen.getAllByRole('button', { name: /^restore$/i })[0]);
    expect(api).not.toHaveBeenCalled();
  });
});
