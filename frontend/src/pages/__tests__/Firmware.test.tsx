import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Firmware from '../Firmware';
import { api, apiUpload } from '../../api';
import { toast } from '../../components/Toast';
import type { Me } from '../../App';

vi.mock('../../api', () => ({ api: vi.fn(), apiUpload: vi.fn(), getToken: vi.fn(() => 'tok'), setToken: vi.fn() }));
vi.mock('../../components/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));

const images = [
  { id: 'img1', filename: 'c9300-17.3.bin', family: 'c9300', version: '17.3.7', md5: 'abcdef0123456789', size_bytes: 800 * 1024 * 1024, uploaded_by: 'admin', created_at: '2026-07-01T00:00:00Z' },
];
const report = [
  { id: 'd1', hostname: 'core-sw', family: 'c9300', model: 'C9300-24T', ios_version: '17.3.5', target_version: '17.3.7', compliant: false },
  { id: 'd2', hostname: 'edge-sw', family: 'c9300', model: 'C9300-48P', ios_version: '17.3.7', target_version: '17.3.7', compliant: true },
];
const devices = [{ id: 'd1', hostname: 'core-sw', family: 'c9300', model: 'C9300-24T' }];

vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn((path: string) =>
    path === '/api/firmware/compliance' ? { data: report, refetch: vi.fn() }
    : path === '/api/devices' ? { data: devices, refetch: vi.fn() }
    : { data: images, refetch: vi.fn() }),
}));

const me = { id: '1', username: 'admin', role: 'netadmin' } as Me;
const renderPage = () => render(<MemoryRouter><Firmware me={me} /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());

describe('Firmware page', () => {
  it('renders the compliance report with per-device status and the image library', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'core-sw' })).toBeInTheDocument();
    expect(screen.getByText('needs upgrade')).toBeInTheDocument();   // d1 running < target
    expect(screen.getByText('compliant')).toBeInTheDocument();       // d2 up to date
    expect(screen.getByText('c9300-17.3.bin')).toBeInTheDocument();
  });

  it('deletes an image after confirming and refetches', async () => {
    vi.mocked(api).mockResolvedValue({ ok: true });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/api/firmware/img1', { method: 'DELETE' }));
  });

  it('surfaces a delete failure as a toast', async () => {
    vi.mocked(api).mockRejectedValue(new Error('image is in use by a campaign'));
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('image is in use by a campaign'));
  });

  it('declining the delete confirm does nothing', async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(api).not.toHaveBeenCalled();
  });

  it('upgrade modal: selecting a device and starting posts the job and navigates to /jobs', async () => {
    vi.mocked(api).mockResolvedValue({ ok: true });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /upgrade devices/i }));
    // eligible device (same family) is listed in the modal
    const devBox = await screen.findByRole('checkbox', { name: /core-sw/i });
    await userEvent.click(devBox);
    await userEvent.click(screen.getByRole('button', { name: /upgrade now/i }));

    await waitFor(() => expect(api).toHaveBeenCalledWith(
      '/api/firmware/img1/upgrade',
      expect.objectContaining({ method: 'POST', body: expect.objectContaining({ deviceIds: ['d1'] }) })));
    expect(navigate).toHaveBeenCalledWith('/jobs');
  });

  it('upload modal validates that file, family, and version are required', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /upload image/i }));
    // click Upload with nothing filled -> inline validation, no network call
    await userEvent.click(screen.getByRole('button', { name: /^upload$/i }));
    expect(await screen.findByText(/are all required/i)).toBeInTheDocument();
    expect(apiUpload).not.toHaveBeenCalled();
  });
});
