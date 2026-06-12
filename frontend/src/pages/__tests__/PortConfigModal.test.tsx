import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PortConfigModal } from '../device/PortsTab';
import type { Port } from '../../components/PortGrid';

vi.mock('../../api', () => ({ api: vi.fn(), getToken: vi.fn(() => 'tok'), setToken: vi.fn() }));
vi.mock('../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn(() => ({ data: [] })) }));

const port: Port = {
  name: 'Gi1/0/5', description: 'printer', admin_up: true, oper_status: 'connected',
  vlan: '10', mode: 'access', speed: 'a-1000', duplex: 'a-full',
  poe_watts: null, input_errors: 0, output_errors: 0, macs: [], flap_count_1h: 0
};

beforeEach(() => vi.clearAllMocks());

describe('PortConfigModal', () => {
  it('sends nothing and just closes when no field was touched', async () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(<PortConfigModal port={port} busy={false} onClose={onClose} onApply={onApply} />);

    await userEvent.click(screen.getByRole('button', { name: /^apply$/i }));
    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('sends only the touched fields', async () => {
    const onApply = vi.fn();
    render(<PortConfigModal port={port} busy={false} onClose={() => {}} onApply={onApply} />);

    await userEvent.type(screen.getByLabelText(/access vlan/i), '20');
    await userEvent.selectOptions(screen.getByLabelText(/poe/i), 'off');
    await userEvent.click(screen.getByRole('button', { name: /^apply$/i }));

    expect(onApply).toHaveBeenCalledWith({ vlan: 20, poeEnabled: false });
  });

  it('access mode sends mode + vlan; voice VLAN included when set', async () => {
    const onApply = vi.fn();
    render(<PortConfigModal port={port} busy={false} onClose={() => {}} onApply={onApply} />);

    await userEvent.selectOptions(screen.getByLabelText(/port mode/i), 'access');
    await userEvent.type(screen.getByLabelText(/access vlan/i), '30');
    await userEvent.type(screen.getByLabelText(/voice vlan/i), '100');
    await userEvent.click(screen.getByRole('button', { name: /^apply$/i }));

    expect(onApply).toHaveBeenCalledWith({ mode: 'access', vlan: 30, voiceVlan: 100 });
  });

  it('trunk mode swaps to native/allowed VLAN fields and warns about uplinks', async () => {
    const onApply = vi.fn();
    render(<PortConfigModal port={port} busy={false} onClose={() => {}} onApply={onApply} />);

    await userEvent.selectOptions(screen.getByLabelText(/port mode/i), 'trunk');
    expect(screen.getByText(/cut off management access/i)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/native vlan/i), '1');
    await userEvent.type(screen.getByLabelText(/allowed vlans/i), '10,20,30-39');
    await userEvent.click(screen.getByRole('button', { name: /^apply$/i }));

    expect(onApply).toHaveBeenCalledWith({
      mode: 'trunk', trunkNativeVlan: 1, trunkAllowedVlans: '10,20,30-39'
    });
  });

  it('spanning tree and link settings map to the right body fields', async () => {
    const onApply = vi.fn();
    render(<PortConfigModal port={port} busy={false} onClose={() => {}} onApply={onApply} />);

    await userEvent.selectOptions(screen.getByLabelText(/portfast/i), 'on');
    await userEvent.selectOptions(screen.getByLabelText(/bpdu guard/i), 'on');
    await userEvent.selectOptions(screen.getByLabelText(/speed/i), '1000');
    await userEvent.selectOptions(screen.getByLabelText(/duplex/i), 'full');
    await userEvent.click(screen.getByRole('button', { name: /^apply$/i }));

    expect(onApply).toHaveBeenCalledWith({
      portfast: true, bpduGuard: true, speed: '1000', duplex: 'full'
    });
  });
});
