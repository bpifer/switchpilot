import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Login from '../Login';

vi.mock('../../api', () => ({
  api: vi.fn(),
  setToken: vi.fn(),
  getToken: vi.fn(() => null)
}));
import { api, setToken } from '../../api';
const apiMock = api as ReturnType<typeof vi.fn>;

beforeEach(() => { vi.clearAllMocks(); });

describe('Login', () => {
  it('renders username and password fields, no MFA field initially', () => {
    render(<Login onLogin={() => {}} />);
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/mfa code/i)).not.toBeInTheDocument();
  });

  it('logs in and hands the profile to onLogin', async () => {
    const me = { id: '1', username: 'admin', role: 'superadmin' };
    apiMock
      .mockResolvedValueOnce({ token: 'jwt-token', user: {} })  // /api/auth/login
      .mockResolvedValueOnce(me);                               // /api/auth/me
    const onLogin = vi.fn();

    render(<Login onLogin={onLogin} />);
    await userEvent.type(screen.getByLabelText(/username/i), 'admin');
    await userEvent.type(screen.getByLabelText(/password/i), 'pw');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(setToken).toHaveBeenCalledWith('jwt-token');
    expect(onLogin).toHaveBeenCalledWith(me);
  });

  it('shows an error message on bad credentials', async () => {
    apiMock.mockRejectedValueOnce(new Error('Invalid username or password'));
    render(<Login onLogin={() => {}} />);
    await userEvent.type(screen.getByLabelText(/username/i), 'admin');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText(/invalid username or password/i)).toBeInTheDocument();
  });

  it('reveals the MFA field when the server requires a code', async () => {
    apiMock.mockRejectedValueOnce(new Error('MFA code required'));
    render(<Login onLogin={() => {}} />);
    await userEvent.type(screen.getByLabelText(/username/i), 'admin');
    await userEvent.type(screen.getByLabelText(/password/i), 'pw');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByLabelText(/mfa code/i)).toBeInTheDocument();
    expect(screen.getByText(/recovery code/i)).toBeInTheDocument();

    // second attempt includes the typed code
    apiMock.mockResolvedValueOnce({ token: 't' }).mockResolvedValueOnce({ id: '1' });
    await userEvent.type(screen.getByLabelText(/mfa code/i), '123456');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(apiMock).toHaveBeenLastCalledWith('/api/auth/me');
    const loginCall = apiMock.mock.calls.find(c => c[0] === '/api/auth/login' && c[1]?.body?.totp);
    expect(loginCall?.[1].body.totp).toBe('123456');
  });
});
