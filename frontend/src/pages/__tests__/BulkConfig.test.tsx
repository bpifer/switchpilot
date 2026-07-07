import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PortsTab from '../device/PortsTab';
import { api } from '../../api';
import type { Port } from '../../components/PortGrid';

vi.mock('../../api', () => ({ api: vi.fn(), getToken: vi.fn(() => 'tok'), setToken: vi.fn() }));
vi.mock('../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn(() => ({ data: [] })) }));

const mkPort = (name: string): Port => ({
  name, description: '', admin_up: true, oper_status: 'connected',
  vlan: '1', mode: 'access', speed: 'a-1000', duplex: 'a-full',
  poe_watts: null, input_errors: 0, output_errors: 0, macs: [], flap_count_1h: 0,
});
const ports = [mkPort('Gi1/0/1'), mkPort('Gi1/0/2'), mkPort('Gi1/0/3')];

const previewData = {
  lines: [{ line: 'switchport access vlan 20', status: 'new', note: 'will be added' }],
  warnings: [], summary: { new: 1, present: 0, removes: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());

describe('Bulk port configuration', () => {
  it('previews against the first port, then applies to every selected port and reports each', async () => {
    vi.mocked(api).mockImplementation(async (path: string) =>
      path.includes('/config/preview')
        ? previewData
        : { verified: { checked: true, ok: true, confirmed: ['vlan'], mismatches: [] } });

    render(<PortsTab deviceId="dev1" ports={ports} canOperate={true} onChanged={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /configure multiple ports/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Gi1/0/1' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Gi1/0/2' }));
    await userEvent.click(screen.getByRole('button', { name: /configure 2 port/i }));

    // One shared config modal (titled with the selection count, not a port name)
    expect(await screen.findByRole('heading', { name: /configure 2 ports/i })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/access vlan/i), '20');
    await userEvent.click(screen.getByRole('button', { name: /^apply$/i }));

    // Dry run hits the FIRST selected port's preview endpoint
    await waitFor(() => expect(api).toHaveBeenCalledWith(
      `/api/devices/dev1/ports/${encodeURIComponent('Gi1/0/1')}/config/preview`,
      { method: 'POST', body: { vlan: 20 } }));

    // Preview modal offers a bulk apply
    await userEvent.click(await screen.findByRole('button', { name: /apply to 2 ports/i }));

    // Both ports get their own apply call with the same body
    await waitFor(() => {
      for (const p of ['Gi1/0/1', 'Gi1/0/2']) {
        expect(api).toHaveBeenCalledWith(
          `/api/devices/dev1/ports/${encodeURIComponent(p)}/config`,
          { method: 'POST', body: { vlan: 20 } });
      }
    });
    // Per-port outcome report
    expect(await screen.findByText(/✓ Gi1\/0\/1/)).toBeInTheDocument();
    expect(screen.getByText(/✓ Gi1\/0\/2/)).toBeInTheDocument();
    // The third (unselected) port was never touched
    expect(api).not.toHaveBeenCalledWith(
      `/api/devices/dev1/ports/${encodeURIComponent('Gi1/0/3')}/config`, expect.anything());
  });

  it('continues past a failing port and reports the failure inline', async () => {
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path.includes('/config/preview')) return previewData;
      if (path.includes(encodeURIComponent('Gi1/0/1'))) throw new Error('ssh timeout');
      return { verified: { checked: true, ok: true, confirmed: [], mismatches: [] } };
    });

    render(<PortsTab deviceId="dev1" ports={ports} canOperate={true} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /configure multiple ports/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Gi1/0/1' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Gi1/0/2' }));
    await userEvent.click(screen.getByRole('button', { name: /configure 2 port/i }));
    await userEvent.type(await screen.findByLabelText(/access vlan/i), '20');
    await userEvent.click(screen.getByRole('button', { name: /^apply$/i }));
    await userEvent.click(await screen.findByRole('button', { name: /apply to 2 ports/i }));

    expect(await screen.findByText(/✗ Gi1\/0\/1: ssh timeout/)).toBeInTheDocument();
    expect(await screen.findByText(/✓ Gi1\/0\/2/)).toBeInTheDocument();
  });

  it('declining the confirm dialog applies nothing', async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    vi.mocked(api).mockResolvedValue(previewData);

    render(<PortsTab deviceId="dev1" ports={ports} canOperate={true} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /configure multiple ports/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Gi1/0/1' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Gi1/0/2' }));
    await userEvent.click(screen.getByRole('button', { name: /configure 2 port/i }));
    await userEvent.type(await screen.findByLabelText(/access vlan/i), '20');
    await userEvent.click(screen.getByRole('button', { name: /^apply$/i }));
    await userEvent.click(await screen.findByRole('button', { name: /apply to 2 ports/i }));

    const applyCalls = vi.mocked(api).mock.calls.filter(([p]) => String(p).endsWith('/config'));
    expect(applyCalls).toHaveLength(0);
  });

  it('a read-back mismatch is reported as a warning, not a success', async () => {
    vi.mocked(api).mockImplementation(async (path: string) =>
      path.includes('/config/preview')
        ? previewData
        : { verified: { checked: true, ok: false, confirmed: [], mismatches: [{ field: 'vlan', expected: '20', actual: '1' }] } });

    render(<PortsTab deviceId="dev1" ports={ports} canOperate={true} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /configure multiple ports/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Gi1/0/1' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Gi1/0/2' }));
    await userEvent.click(screen.getByRole('button', { name: /configure 2 port/i }));
    await userEvent.type(await screen.findByLabelText(/access vlan/i), '20');
    await userEvent.click(screen.getByRole('button', { name: /^apply$/i }));
    await userEvent.click(await screen.findByRole('button', { name: /apply to 2 ports/i }));

    expect(await screen.findByText(/⚠ Gi1\/0\/1: applied, but read-back differs/)).toBeInTheDocument();
    expect(screen.getByText(/vlan: expected 20, got 1/)).toBeInTheDocument();
  });
});
