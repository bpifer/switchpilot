import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import OnboardWizard from '../../components/OnboardWizard';

vi.mock('../../api', () => ({ api: vi.fn(), getToken: vi.fn(() => 'tok'), setToken: vi.fn() }));
import { api } from '../../api';
const apiMock = api as ReturnType<typeof vi.fn>;

const ANALYSIS = {
  vendor: 'cisco',
  identity: { hostname: 'SW-TEST-01', model: 'WS-C2960X-24TS-L', serial: 'FCW123', iosVersion: '15.2(7)E5' },
  users: [{ name: 'admin', priv15: true }],
  checklist: [
    { key: 'lldp', label: 'LLDP enabled (lldp run)', present: false, why: 'neighbor discovery' },
    { key: 'syslog', label: 'Syslog forwarding to 10.0.0.1', present: true, why: 'alerts' }
  ],
  usingPlatformAccount: false,
  spAdminExists: false,
  otherAdmins: ['admin']
};

const wizard = () => render(<MemoryRouter><OnboardWizard sites={[]} onClose={() => {}} /></MemoryRouter>);

async function fillAndVerify() {
  await userEvent.type(screen.getByLabelText(/management ip/i), '192.168.1.10');
  await userEvent.type(screen.getByLabelText(/username/i), 'admin');
  await userEvent.type(screen.getByLabelText(/^password$/i), 'secret');
  await userEvent.click(screen.getByRole('button', { name: /connect & verify/i }));
}

beforeEach(() => vi.clearAllMocks());

describe('OnboardWizard', () => {
  it('verify shows device identity, config review with missing badges', async () => {
    apiMock.mockResolvedValueOnce(ANALYSIS);
    wizard();
    await fillAndVerify();

    expect(apiMock).toHaveBeenCalledWith('/api/onboarding/analyze', expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({ mgmtIp: '192.168.1.10', username: 'admin', password: 'secret' })
    }));
    expect(await screen.findByText('SW-TEST-01')).toBeInTheDocument();
    expect(screen.getByText(/LLDP enabled/)).toBeInTheDocument();
    expect(screen.getByText('missing')).toBeInTheDocument();
    // fresh switch: SPAdmin creation offered and on by default
    const checkbox = screen.getAllByRole('checkbox')[0];
    expect(checkbox).toBeChecked();
  });

  it('connection errors stay on the connect step', async () => {
    apiMock.mockRejectedValueOnce(new Error('All configured authentication methods failed'));
    wizard();
    await fillAndVerify();

    expect(await screen.findByText(/authentication methods failed/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/management ip/i)).toBeInTheDocument();   // still step 1
  });

  it('existing SPAdmin removes the create-account option and confirms it is present', async () => {
    apiMock.mockResolvedValueOnce({ ...ANALYSIS, spAdminExists: true });
    wizard();
    await fillAndVerify();

    expect(await screen.findByText(/SPAdmin account already present/i)).toBeInTheDocument();
    expect(screen.queryByText(/Create dedicated SPAdmin account/i)).not.toBeInTheDocument();
  });

  it('completes onboarding and shows the generated password exactly once', async () => {
    apiMock
      .mockResolvedValueOnce(ANALYSIS)   // analyze
      .mockResolvedValueOnce({           // complete
        device: { id: 'dev-1', hostname: 'SW-TEST-01' },
        account: 'SPAdmin',
        generatedPassword: 'rAnd0mGenerated42',
        warnings: []
      });
    wizard();
    await fillAndVerify();
    await screen.findByText('SW-TEST-01');

    await userEvent.click(screen.getByRole('button', { name: /add switch/i }));

    expect(await screen.findByText(/added successfully/i)).toBeInTheDocument();
    expect(screen.getByText('rAnd0mGenerated42')).toBeInTheDocument();
    expect(screen.getByText(/shown once/i)).toBeInTheDocument();
    expect(apiMock).toHaveBeenLastCalledWith('/api/onboarding/complete', expect.objectContaining({
      body: expect.objectContaining({ createAccount: true, applyBaseline: true })
    }));
  });
});
