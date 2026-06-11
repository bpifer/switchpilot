import { describe, it, expect, afterEach } from 'vitest';
import { CiscoSshSession, runCommands } from '../src/cisco/sshClient.js';
import { parseShowVersion, parseInterfacesStatus } from '../src/cisco/parsers.js';
import { startMockDevice, type RunningMock } from './helpers/mockCiscoDevice.js';
import * as fx from './fixtures/cisco.js';

// End-to-end exercise of the real SSH session against a fake Cisco device:
// validates the shell read loop, enable mode, prompt detection, exec output
// extraction, and config-mode error handling — no hardware required.

let device: RunningMock;
afterEach(async () => { await device?.close(); });

const RESPONSES = {
  'show version': fx.SHOW_VERSION_IOSXE,
  'show interfaces status': fx.SHOW_INTERFACES_STATUS,
  'show running-config': fx.RUNNING_CONFIG_COMPLIANT,
};

describe('CiscoSshSession against a mock device', () => {
  it('connects, enables, and runs show commands', async () => {
    device = await startMockDevice({ hostname: 'core-sw-01', responses: RESPONSES });
    const session = new CiscoSshSession({ host: '127.0.0.1', port: device.port, username: 'admin', password: 'x' });
    await session.connect();
    try {
      await session.enable();
      const version = await session.exec('show version');
      expect(parseShowVersion(version).model).toBe('C9300-48P');

      const ifaces = await session.exec('show interfaces status');
      expect(parseInterfacesStatus(ifaces)).toHaveLength(6);
    } finally {
      session.close();
    }
  }, 20000);

  it('runCommands returns a per-command output map', async () => {
    device = await startMockDevice({ responses: RESPONSES });
    const out = await runCommands(
      { host: '127.0.0.1', port: device.port, username: 'admin', password: 'x' },
      ['show version', 'show running-config']);
    expect(out['show version']).toContain('C9300-48P');
    expect(out['show running-config']).toContain('aaa new-model');
  }, 20000);

  it('applies config lines and rejects invalid commands', async () => {
    device = await startMockDevice({ responses: RESPONSES, rejectConfigContaining: ['frobnicate'] });
    const session = new CiscoSshSession({ host: '127.0.0.1', port: device.port, username: 'admin', password: 'x' });
    await session.connect();
    try {
      await session.enable();
      const ok = await session.configure(['interface Gi1/0/1', 'description test-port']);
      expect(ok).toBeTypeOf('string');
      await expect(session.configure(['frobnicate the widget'])).rejects.toThrow(/rejected/i);
    } finally {
      session.close();
    }
  }, 20000);
});
