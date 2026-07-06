import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Alerts from '../Alerts';
import { api } from '../../api';
import type { Me } from '../../App';

vi.mock('../../api', () => ({ api: vi.fn() }));
vi.mock('../../context/SiteContext', () => ({
  useSiteScope: () => ({ siteId: '', setSiteId: () => {} }),
  scoped: (p: string) => p,
}));

let alerts: any[] = [];
let rules: any[] = [];
vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn((path: string) => {
    if (path.startsWith('/api/alerts')) return { data: alerts, refetch: vi.fn() };
    if (path === '/api/automation/rules') return { data: rules, refetch: vi.fn() };
    return { data: [], refetch: vi.fn() };
  }),
}));

const me = { id: '1', username: 'admin', role: 'netadmin' } as Me;
const renderPage = () => render(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter><Alerts me={me} /></MemoryRouter>
  </QueryClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  alerts = [{ id: 'al1', severity: 'warning', hostname: 'core-sw', message: 'port down', created_at: new Date().toISOString(), acknowledged: false, resolved_at: null }];
  rules = [{ id: 'r1', name: 'notify on down', trigger: 'port_down', action: 'notify', condition: {}, action_params: { message: 'hi' }, enabled: true }];
  vi.mocked(api).mockResolvedValue({ ok: true });
});

describe('Alerts — acknowledge with note', () => {
  it('opens a note modal and posts the note on acknowledge', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^ack$/i }));
    await userEvent.type(screen.getByPlaceholderText(/known issue/i), 'RMA pending');
    await userEvent.click(screen.getByRole('button', { name: /^acknowledge$/i }));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/api/alerts/al1/ack', { method: 'POST', body: { note: 'RMA pending' } }));
  });

  it('shows the ack note and acknowledger in history', () => {
    alerts = [{ id: 'al2', severity: 'info', hostname: 'sw2', message: 'x', created_at: new Date().toISOString(), acknowledged: true, acknowledged_by: 'bob', ack_note: 'expected', resolved_at: null }];
    renderPage();
    expect(screen.getByText(/ack.?d by bob/i)).toBeInTheDocument();
    expect(screen.getByText(/expected/)).toBeInTheDocument();
  });
});

describe('Alerts — resolve confirmation', () => {
  it('does nothing when the confirm is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^resolve$/i }));
    expect(api).not.toHaveBeenCalled();
  });

  it('posts the resolve when confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^resolve$/i }));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/api/alerts/al1/resolve', { method: 'POST' }));
  });
});

describe('Alerts — automation rule editing', () => {
  it('opens the edit modal prefilled and PATCHes the changes', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    const name = screen.getByDisplayValue('notify on down');
    await userEvent.clear(name);
    await userEvent.type(name, 'renamed rule');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/api/automation/rules/r1',
      expect.objectContaining({ method: 'PATCH', body: expect.objectContaining({ name: 'renamed rule' }) })));
  });
});
