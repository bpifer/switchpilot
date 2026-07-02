import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Compliance from '../Compliance';
import { api } from '../../api';
import type { Me } from '../../App';

vi.mock('../../api', () => ({ api: vi.fn(), getToken: vi.fn(() => 'tok'), setToken: vi.fn() }));
vi.mock('../../components/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../../context/SiteContext', () => ({
  useSiteScope: () => ({ siteId: '', setSiteId: () => {} }),
  scoped: (p: string) => p,
}));

// Fleet summary supplied via the query hook; refetch is a spy.
let summary: any;
const refetch = vi.fn();
vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(() => ({ data: summary, isLoading: false, refetch })),
}));

const me = { id: '1', username: 'admin', role: 'netadmin' } as Me;
const renderPage = () => render(<MemoryRouter><Compliance me={me} /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  summary = {
    score: 82, passed: 41, total: 50,
    rules: [{ id: 'r1', name: 'NTP configured', severity: 'warning', match_type: 'line_present', pattern: 'ntp server', passed: 9, total: 10 }],
    devices: [{ id: 'd1', hostname: 'core-sw', mgmt_ip: '10.0.0.1', site_name: 'HQ', passed: 8, total: 10, critical_fails: 1 }],
  };
});

describe('Compliance summary', () => {
  it('shows the fleet score, rule rollup, and per-device rows', () => {
    renderPage();
    expect(screen.getByText('82%')).toBeInTheDocument();
    expect(screen.getByText(/41 \/ 50 checks passing/)).toBeInTheDocument();
    expect(screen.getByText('NTP configured')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'core-sw' })).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();   // critical fails badge
  });

  it('renders the empty state when nothing has been evaluated', () => {
    summary = { score: null, passed: 0, total: 0, rules: [], devices: [] };
    renderPage();
    expect(screen.getByText(/No compliance results yet/i)).toBeInTheDocument();
  });

  it('"Run evaluation" posts and refetches the summary', async () => {
    vi.mocked(api).mockResolvedValue({ ok: true });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /run evaluation/i }));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/api/compliance/evaluate', { method: 'POST' }));
    expect(refetch).toHaveBeenCalled();
  });
});

describe('Compliance device checks', () => {
  const failingCheck = {
    rule_id: 'r1', name: 'NTP configured', description: 'NTP must be set', severity: 'warning',
    remediation: 'ntp server 10.0.0.1', benchmark: '', passed: false, detail: 'no line contains "ntp server"', checked_at: null,
  };

  it('opens the checks modal and lists the device rules', async () => {
    vi.mocked(api).mockResolvedValue([failingCheck]);
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /view checks/i }));
    expect(await screen.findByText(/Compliance checks/i)).toBeInTheDocument();
    await waitFor(() => expect(api).toHaveBeenCalledWith('/api/compliance/device/d1'));
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('Preview runs a dry-run remediation and opens the preview modal', async () => {
    vi.mocked(api).mockImplementation(async (path: string, opts?: any) => {
      if (path === '/api/compliance/device/d1') return [failingCheck];
      if (path === '/api/compliance/remediate' && opts?.body?.dryRun) {
        return { lines: [{ line: 'ntp server 10.0.0.1', status: 'new', note: '' }], summary: { new: 1, present: 0, removes: 0 }, warnings: [] };
      }
      return { ok: true };
    });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /view checks/i }));
    await screen.findByText('Failed');
    await userEvent.click(screen.getByRole('button', { name: /^Preview$/i }));

    await waitFor(() => expect(api).toHaveBeenCalledWith('/api/compliance/remediate',
      { method: 'POST', body: { deviceId: 'd1', ruleId: 'r1', dryRun: true } }));
    // The preview modal shows the line that would be pushed + an apply action.
    expect(await screen.findByText('ntp server 10.0.0.1')).toBeInTheDocument();
  });

  it('Remediate pushes the fix (no dryRun) and reloads the checks', async () => {
    const calls: any[] = [];
    vi.mocked(api).mockImplementation(async (path: string, opts?: any) => {
      calls.push({ path, opts });
      if (path === '/api/compliance/device/d1') return [failingCheck];
      return { ok: true, output: 'applied' };
    });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /view checks/i }));
    await screen.findByText('Failed');
    await userEvent.click(screen.getByRole('button', { name: /^Remediate$/i }));

    await waitFor(() => expect(calls.some(c =>
      c.path === '/api/compliance/remediate' && c.opts?.body?.deviceId === 'd1' && !c.opts?.body?.dryRun)).toBe(true));
    // device checks were re-fetched after the push (initial load + reload)
    await waitFor(() => expect(calls.filter(c => c.path === '/api/compliance/device/d1').length).toBeGreaterThanOrEqual(2));
  });

  it('"Check now" re-evaluates against the live config (fresh=true)', async () => {
    vi.mocked(api).mockResolvedValue([failingCheck]);
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /view checks/i }));
    await screen.findByText('Failed');
    await userEvent.click(screen.getByRole('button', { name: /check now/i }));
    await waitFor(() => expect(api).toHaveBeenCalledWith(
      '/api/compliance/evaluate?deviceId=d1&fresh=true', { method: 'POST' }));
  });
});
