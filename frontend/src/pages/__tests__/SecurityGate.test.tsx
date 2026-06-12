import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SecurityGate from '../SecurityGate';
import type { Me } from '../../App';

vi.mock('../../api', () => ({ api: vi.fn() }));
import { api } from '../../api';
const apiMock = api as ReturnType<typeof vi.fn>;

beforeEach(() => { vi.clearAllMocks(); });

const mfaMe = { id: '1', username: 'jdoe', role: 'netadmin', mfa_setup_required: true } as unknown as Me;
const pwMe = { id: '1', username: 'jdoe', role: 'netadmin', must_change_password: true } as unknown as Me;

describe('SecurityGate', () => {
  it('blocks with a password change form when one is required', () => {
    render(<SecurityGate me={pwMe} onComplete={() => {}} onLogout={() => {}} />);
    expect(screen.getByText(/password change is required/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /change password/i })).toBeInTheDocument();
  });

  it('walks through MFA enrollment and shows recovery codes exactly once', async () => {
    const onComplete = vi.fn();
    render(<SecurityGate me={mfaMe} onComplete={onComplete} onLogout={() => {}} />);
    expect(screen.getByText(/multi-factor authentication is required/i)).toBeInTheDocument();

    // step 1: request a secret
    apiMock.mockResolvedValueOnce({ secret: 'JBSWY3DPEHPK3PXP', otpauthUrl: 'otpauth://totp/x' });
    await userEvent.click(screen.getByRole('button', { name: /begin mfa setup/i }));
    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();

    // step 2: confirm with a code; server returns recovery codes
    apiMock.mockResolvedValueOnce({ ok: true, backupCodes: ['aaaa111111', 'bbbb222222'] });
    await userEvent.type(screen.getByLabelText(/enter the 6-digit code/i), '123456');
    await userEvent.click(screen.getByRole('button', { name: /enable mfa/i }));

    // recovery codes are displayed and gate completion waits for acknowledgement
    expect(await screen.findByText('aaaa111111')).toBeInTheDocument();
    expect(screen.getByText('bbbb222222')).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /i saved them/i }));
    expect(onComplete).toHaveBeenCalled();
  });

  it('shows the error and stays on the form when the code is rejected', async () => {
    render(<SecurityGate me={mfaMe} onComplete={() => {}} onLogout={() => {}} />);
    apiMock.mockResolvedValueOnce({ secret: 'S', otpauthUrl: 'otpauth://x' });
    await userEvent.click(screen.getByRole('button', { name: /begin mfa setup/i }));
    apiMock.mockRejectedValueOnce(new Error('Invalid code - MFA not enabled'));
    await userEvent.type(await screen.findByLabelText(/enter the 6-digit code/i), '000000');
    await userEvent.click(screen.getByRole('button', { name: /enable mfa/i }));
    expect(await screen.findByText(/invalid code/i)).toBeInTheDocument();
  });
});
