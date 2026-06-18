import { describe, it, expect, vi } from 'vitest';
import { hostKeyFingerprint, makeHostVerifier, buildSshVerification } from '../src/cisco/hostKey.js';
import type { SshTarget } from '../src/cisco/sshClient.js';

const KEY_A = Buffer.from('host-public-key-blob-device-alpha');
const KEY_B = Buffer.from('host-public-key-blob-device-bravo');

describe('hostKeyFingerprint', () => {
  it('is deterministic, SHA256-prefixed, and unpadded', () => {
    const fp = hostKeyFingerprint(KEY_A);
    expect(fp).toMatch(/^SHA256:[A-Za-z0-9+/]+$/);
    expect(fp.endsWith('=')).toBe(false);
    expect(hostKeyFingerprint(KEY_A)).toBe(fp);      // same key -> same fp
    expect(hostKeyFingerprint(KEY_B)).not.toBe(fp);  // different key -> different fp
  });
});

describe('makeHostVerifier', () => {
  it('pins (accepts) the first key when none is pinned', () => {
    const onPin = vi.fn();
    const onMismatch = vi.fn();
    const verify = makeHostVerifier({ expectedFp: '', onPin, onMismatch });
    expect(verify(KEY_A)).toBe(true);
    expect(onPin).toHaveBeenCalledWith(hostKeyFingerprint(KEY_A));
    expect(onMismatch).not.toHaveBeenCalled();
  });

  it('treats null/undefined expectedFp as unpinned', () => {
    expect(makeHostVerifier({ expectedFp: null })(KEY_A)).toBe(true);
    expect(makeHostVerifier({})(KEY_A)).toBe(true);
  });

  it('accepts a matching pinned key without re-pinning', () => {
    const onPin = vi.fn();
    const verify = makeHostVerifier({ expectedFp: hostKeyFingerprint(KEY_A), onPin });
    expect(verify(KEY_A)).toBe(true);
    expect(onPin).not.toHaveBeenCalled();
  });

  it('rejects a changed key and reports the mismatch', () => {
    const onMismatch = vi.fn();
    const verify = makeHostVerifier({ expectedFp: hostKeyFingerprint(KEY_A), onMismatch });
    expect(verify(KEY_B)).toBe(false);
    expect(onMismatch).toHaveBeenCalledWith(hostKeyFingerprint(KEY_B), hostKeyFingerprint(KEY_A));
  });

  it('never throws out of a misbehaving hook (handshake must not crash)', () => {
    const verify = makeHostVerifier({ expectedFp: '', onPin: () => { throw new Error('db down'); } });
    expect(() => verify(KEY_A)).not.toThrow();
    expect(verify(KEY_A)).toBe(true);
  });
});

describe('buildSshVerification', () => {
  it('passes through no verifier when the target has none (prior behavior)', () => {
    const { hostVerifier, rejectionError } = buildSshVerification(
      { host: 'x', username: 'u', password: 'p' } as SshTarget);
    expect(hostVerifier).toBeUndefined();
    expect(rejectionError()).toBeNull();
  });

  it('surfaces a clear, host-scoped error when the wrapped verifier rejects', () => {
    const target = { host: '10.0.0.9', username: 'u', password: 'p', hostVerifier: () => false } as SshTarget;
    const { hostVerifier, rejectionError } = buildSshVerification(target);
    expect(rejectionError()).toBeNull();                 // nothing rejected yet
    expect(hostVerifier!(KEY_B)).toBe(false);
    expect(rejectionError()?.message).toMatch(/host key for 10\.0\.0\.9 does not match/i);
  });

  it('stays silent when the wrapped verifier accepts', () => {
    const target = { host: 'x', username: 'u', password: 'p', hostVerifier: () => true } as SshTarget;
    const { hostVerifier, rejectionError } = buildSshVerification(target);
    expect(hostVerifier!(KEY_A)).toBe(true);
    expect(rejectionError()).toBeNull();
  });
});
