// Diagnostics bundle: the pure command lists and the renderer. The critical
// properties are (a) nothing in any command list can modify a device, and
// (b) secrets in captured output never reach the rendered bundle.
import { describe, it, expect, vi } from 'vitest';

// The service imports I/O modules at load; none are used by the pure parts.
vi.mock('../src/services/deviceComms.js', () => ({
  getDevice: vi.fn(), sshTargetFor: vi.fn(), snmpTargetFor: vi.fn(),
}));
vi.mock('../src/cisco/sshPool.js', () => ({ withDeviceSession: vi.fn() }));
vi.mock('../src/cisco/snmpClient.js', () => ({ snmpGet: vi.fn(), snmpWalk: vi.fn() }));

import { diagnosticCommands, renderDiagnostics, ARUBA_DIAG_WALKS } from '../src/services/diagnosticsService.js';

const DEVICE = {
  hostname: 'SW-TEST', mgmt_ip: '192.168.1.20', model: 'WS-C2960X-24TS-L',
  family: 'catalyst2960', vendor: 'cisco', ios_version: '15.2(7)E14',
  serial_number: 'ABC123', capabilities: { os: 'ios' },
};

describe('diagnosticCommands', () => {
  it('is strictly read-only for every vendor/os combination', () => {
    for (const [vendor, os] of [['cisco', 'ios'], ['cisco', 'iosxe'], ['cisco', 'nxos'], ['mikrotik', 'routeros']] as const) {
      const cmds = diagnosticCommands(vendor, os);
      expect(cmds.length).toBeGreaterThan(5);
      for (const c of cmds) {
        // Cisco: show-only. RouterOS: print-only. Nothing config-shaped.
        expect(c, `${vendor}/${os}: ${c}`).toMatch(/^show |print( terse)?$|print$/);
        expect(c).not.toMatch(/configure|write|delete|remove|set |add |reload|reboot|upgrade/i);
      }
    }
  });

  it('picks the right memory/environment variants per os', () => {
    expect(diagnosticCommands('cisco', 'nxos')).toContain('show system resources | include Memory');
    expect(diagnosticCommands('cisco', 'iosxe')).toContain('show environment all');
    expect(diagnosticCommands('cisco', 'ios')).toContain('show env all');
  });

  it('Aruba walk set covers the subtrees the monitor and write layer parse', () => {
    for (const key of ['ifName', 'ifOperStatus', 'dot1qPvid', 'dot1dBasePortIfIndex']) {
      expect(ARUBA_DIAG_WALKS[key]).toMatch(/^1\./);
    }
  });
});

describe('renderDiagnostics', () => {
  it('includes the header, device identity, and every section', () => {
    const out = renderDiagnostics(DEVICE, [
      { title: 'show version', body: 'Cisco IOS Software...' },
      { title: 'show env all', body: 'FAN is OK' },
    ]);
    expect(out).toContain('SwitchPilot diagnostics bundle');
    expect(out).toContain('hostname  : SW-TEST');
    expect(out).toContain('model     : WS-C2960X-24TS-L');
    expect(out).toContain('$ show version');
    expect(out).toContain('FAN is OK');
  });

  it('redacts passwords, secrets, and SNMP communities in section bodies', () => {
    const out = renderDiagnostics(DEVICE, [{
      title: 'show running-config | include username|snmp',
      body: [
        'username admin privilege 15 secret 5 $1$abcd$WOULDLEAK',
        'snmp-server community sup3rs3cret RO',
        'enable password 7 05080F1C2243',
      ].join('\n'),
    }]);
    expect(out).not.toContain('WOULDLEAK');
    expect(out).not.toContain('sup3rs3cret');
    expect(out).not.toContain('05080F1C2243');
    expect(out).toContain('[redacted]');
  });

  it('renders empty output and failure text sections legibly', () => {
    const out = renderDiagnostics(DEVICE, [
      { title: 'show power inline', body: '' },
      { title: 'show switch', body: 'COMMAND FAILED: Timed out waiting for device prompt' },
    ]);
    expect(out).toContain('(no output)');
    expect(out).toContain('COMMAND FAILED: Timed out');
  });
});
