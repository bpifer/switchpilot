import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Topology from '../Topology';
import { api } from '../../api';
import type { Me } from '../../App';

vi.mock('../../api', () => ({ api: vi.fn() }));
vi.mock('../../components/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../../context/SiteContext', () => ({
  useSiteScope: () => ({ siteId: '', setSiteId: () => {} }),
  scoped: (p: string) => p,
}));

let graph: any;
const refetch = vi.fn();
vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(() => ({ data: graph, refetch })),
}));

const me = { id: '1', username: 'admin', role: 'netadmin' } as Me;
const renderPage = () => render(<MemoryRouter><Topology me={me} /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  graph = {
    nodes: [
      { id: 'a', label: 'core-sw', model: 'C9300', status: 'online', managed: true, ip: '10.0.0.1', stackSize: 0 },
      { id: 'b', label: 'edge-sw', model: 'CRS326', status: 'online', managed: true, ip: '10.0.0.2', stackSize: 0 },
      // the API includes external targets as unmanaged nodes
      { id: 'ext:pfsense', label: 'pfSense', model: '', status: 'unknown', managed: false, ip: null, stackSize: 0 },
    ],
    edges: [
      { source: 'a', target: 'b', sourcePort: 'Gi1/0/1', targetPort: 'ether1', protocol: 'lldp' },
      { source: 'a', target: 'ext:pfsense', sourcePort: 'Gi1/0/24', targetPort: 'LAN1', protocol: 'manual', manual: true, manualId: 'm1', note: 'uplink' },
    ],
  };
  vi.mocked(api).mockResolvedValue({ ok: true });
});

describe('Topology — manual links', () => {
  it('netadmin sees the + Link button; the modal posts and refetches', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /\+ link/i }));
    // From: core-sw, To: something unmanaged with a label
    const selects = screen.getAllByRole('combobox');
    await userEvent.selectOptions(selects[0], 'a');
    await userEvent.selectOptions(selects[1], 'external');
    await userEvent.type(screen.getByPlaceholderText(/pfsense, isp ont/i), 'ISP ONT');
    await userEvent.click(screen.getByRole('button', { name: /add link/i }));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/api/topology/manual-links',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({ fromDeviceId: 'a', toDeviceId: null, toLabel: 'ISP ONT' }),
      })));
    expect(refetch).toHaveBeenCalled();
  });

  it('requires a target before enabling Add link', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /\+ link/i }));
    const add = screen.getByRole('button', { name: /add link/i });
    expect(add).toBeDisabled();
    const selects = screen.getAllByRole('combobox');
    await userEvent.selectOptions(selects[0], 'a');
    expect(add).toBeDisabled();                    // still no target
    await userEvent.selectOptions(selects[1], 'b');
    expect(add).toBeEnabled();
  });

  it('readonly users get no + Link button', () => {
    render(<MemoryRouter><Topology me={{ ...me, role: 'readonly' } as Me} /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /\+ link/i })).not.toBeInTheDocument();
  });

  it('clicking a manual edge confirms then deletes it', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { container } = renderPage();
    // The manual edge group is the second edge <g>; click its hit-target line.
    const lines = container.querySelectorAll('svg g g line');
    // groups render two lines each (hit target + visible); manual edge is group 2
    await userEvent.click(lines[2] as Element);
    await waitFor(() => expect(api).toHaveBeenCalledWith('/api/topology/manual-links/m1', { method: 'DELETE' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('a discovered edge click never issues a delete', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { container } = renderPage();
    const lines = container.querySelectorAll('svg g g line');
    await userEvent.click(lines[0] as Element);    // lldp edge hit-target
    expect(api).not.toHaveBeenCalled();
  });
});
