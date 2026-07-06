import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Devices from '../Devices';
import type { Me } from '../../App';

vi.mock('../../api', () => ({ api: vi.fn(), getToken: vi.fn(() => 'tok') }));
vi.mock('../../components/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../../context/SiteContext', () => ({
  useSiteScope: () => ({ siteId: '', setSiteId: () => {} }),
  scoped: (p: string) => p,
}));
// OnboardWizard pulls in heavier deps and isn't under test here.
vi.mock('../../components/OnboardWizard', () => ({ default: () => null }));

let devices: any[] = [];
vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn((path: string) => {
    if (path === '/api/devices') return { data: devices, refetch: vi.fn() };
    return { data: [], refetch: vi.fn() };
  }),
}));

const me = { id: '1', username: 'admin', role: 'netadmin' } as Me;
const renderPage = () => render(<MemoryRouter><Devices me={me} /></MemoryRouter>);

// Data row hostnames live in the first column as links, so reading them back in
// order proves the current sort/filter.
function rowHostnames(): string[] {
  return screen.getAllByRole('row')
    .map(r => within(r).queryAllByRole('link')[0]?.textContent ?? '')
    .filter(Boolean);
}

beforeEach(() => {
  vi.clearAllMocks();
  devices = [
    { id: 'a', hostname: 'zeta-sw', mgmt_ip: '10.0.0.3', model: 'CRS326', serial_number: 'SNZ', status: 'offline', cpu_pct: 12, mem_pct: 30, uptime_seconds: 100, vendor: 'mikrotik' },
    { id: 'b', hostname: 'alpha-sw', mgmt_ip: '10.0.0.1', model: 'C9300', serial_number: 'SNA', status: 'online', cpu_pct: 91, mem_pct: 40, uptime_seconds: 500 },
    { id: 'c', hostname: 'mid-sw', mgmt_ip: '10.0.0.2', model: 'C2960', serial_number: 'SNM', status: 'online', cpu_pct: 5, mem_pct: 20, uptime_seconds: 300 },
  ];
});

describe('Devices list — sort & filter', () => {
  it('defaults to hostname ascending', () => {
    renderPage();
    expect(rowHostnames()).toEqual(['alpha-sw', 'mid-sw', 'zeta-sw']);
  });

  it('clicking a column header sorts asc then desc', async () => {
    renderPage();
    // CPU: numeric column. Ascending -> 5, 12, 91.
    await userEvent.click(screen.getByRole('button', { name: /CPU/i }));
    expect(rowHostnames()).toEqual(['mid-sw', 'zeta-sw', 'alpha-sw']);
    // Second click flips to descending -> 91, 12, 5.
    await userEvent.click(screen.getByRole('button', { name: /CPU/i }));
    expect(rowHostnames()).toEqual(['alpha-sw', 'zeta-sw', 'mid-sw']);
  });

  it('the status dropdown filters to matching devices', async () => {
    renderPage();
    await userEvent.selectOptions(screen.getByRole('combobox'), 'offline');
    expect(rowHostnames()).toEqual(['zeta-sw']);
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
  });

  it('search matches hostname, IP, model, or serial', async () => {
    renderPage();
    const box = screen.getByPlaceholderText(/search hostname/i);
    await userEvent.type(box, 'C9300');            // model match
    expect(rowHostnames()).toEqual(['alpha-sw']);
    await userEvent.clear(box);
    await userEvent.type(box, 'SNM');              // serial match
    expect(rowHostnames()).toEqual(['mid-sw']);
    await userEvent.clear(box);
    await userEvent.type(box, '10.0.0.3');         // ip match
    expect(rowHostnames()).toEqual(['zeta-sw']);
  });

  it('shows a "no match" row when the filter excludes everything', async () => {
    renderPage();
    await userEvent.type(screen.getByPlaceholderText(/search hostname/i), 'nonexistent-device');
    expect(rowHostnames()).toEqual([]);
    expect(screen.getByText(/no devices match/i)).toBeInTheDocument();
  });
});
