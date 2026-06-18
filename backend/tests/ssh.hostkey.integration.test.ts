import { describe, it, expect, afterEach } from 'vitest';
import { CiscoSshSession, type SshTarget } from '../src/cisco/sshClient.js';
import { makeHostVerifier } from '../src/cisco/hostKey.js';
import { startMockDevice, type RunningMock } from './helpers/mockCiscoDevice.js';

// End-to-end host-key pinning over a real ssh2 handshake against the mock device.
// The mock generates a stable host key per instance, so one instance models a
// single switch; a wrong pinned fingerprint models a swapped/MITM'd key.
let device: RunningMock;
afterEach(async () => { await device?.close(); });

describe('SSH host-key pinning (CiscoSshSession)', () => {
  it('pins on first connect (TOFU), then accepts the same key', async () => {
    device = await startMockDevice({ hostname: 'sw1' });
    let pinned = '';
    const target = (expectedFp: string): SshTarget => ({
      host: '127.0.0.1', port: device.port, username: 'admin', password: 'x',
      hostVerifier: makeHostVerifier({ expectedFp, onPin: fp => { pinned = fp; } })
    });

    // Nothing pinned yet -> trust on first use, capture the fingerprint.
    const s1 = new CiscoSshSession(target(''));
    await s1.connect();
    s1.close();
    expect(pinned).toMatch(/^SHA256:/);

    // Reconnect with that fingerprint pinned -> same key is accepted.
    const s2 = new CiscoSshSession(target(pinned));
    await s2.connect();
    s2.close();
  }, 20000);

  it('refuses to connect when the host key does not match the pinned one', async () => {
    device = await startMockDevice({ hostname: 'sw1' });
    const session = new CiscoSshSession({
      host: '127.0.0.1', port: device.port, username: 'admin', password: 'x',
      hostVerifier: makeHostVerifier({ expectedFp: 'SHA256:bogusbogusbogusbogusbogusbogusbogusbogusxyz' })
    });
    // Rejection happens inside the handshake (before auth), surfaced clearly.
    await expect(session.connect()).rejects.toThrow(/host key/i);
  }, 20000);
});
