// SSH host-key pinning (trust-on-first-use). The session classes accept any key
// today, so a man-in-the-middle on the management network can impersonate a
// switch and capture credentials. This module fingerprints the presented host
// key and lets the policy layer pin it on first contact and reject changes
// thereafter — the rejection happens inside ssh2's hostVerifier, i.e. BEFORE
// authentication, so the password is never sent to an unverified host.
import crypto from 'node:crypto';
import type { SshTarget } from './sshClient.js';

/** OpenSSH-style SHA256 fingerprint of the host public-key blob ssh2 hands to
 *  hostVerifier: base64(sha256(key)) with the trailing '=' padding stripped,
 *  matching `ssh-keygen -lf`. */
export function hostKeyFingerprint(key: Buffer): string {
  const b64 = crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
  return `SHA256:${b64}`;
}

export interface HostVerifierHooks {
  /** Fingerprint already pinned for this device; '' / null / undefined = unpinned. */
  expectedFp?: string | null;
  /** Fired (fire-and-forget) the first time a key is seen for an unpinned device. */
  onPin?: (fp: string) => void;
  /** Fired (fire-and-forget) when the presented key does not match the pinned one. */
  onMismatch?: (presentedFp: string, expectedFp: string) => void;
}

/**
 * Build an ssh2 `hostVerifier`. With no pinned fingerprint we record the
 * presented key and accept (trust on first use); once pinned we accept only that
 * exact key and reject everything else. Hook callbacks must not throw — they run
 * inside the handshake and are best-effort side effects (persist / audit).
 */
export function makeHostVerifier(hooks: HostVerifierHooks): (key: Buffer) => boolean {
  return (key: Buffer) => {
    const fp = hostKeyFingerprint(key);
    const expected = hooks.expectedFp ?? '';
    if (!expected) {
      try { hooks.onPin?.(fp); } catch { /* best-effort */ }
      return true;
    }
    if (fp === expected) return true;
    try { hooks.onMismatch?.(fp, expected); } catch { /* best-effort */ }
    return false;
  };
}

/**
 * Wrap a target's hostVerifier so a session can surface a clear, actionable
 * error on rejection — ssh2's native handshake failure is opaque. Returns an
 * undefined verifier (no-op host checking, ssh2's prior behavior) when the
 * target carries none, so callers that don't pin are unaffected.
 */
export function buildSshVerification(t: SshTarget): {
  hostVerifier?: (key: Buffer) => boolean;
  rejectionError: () => Error | null;
} {
  const inner = t.hostVerifier;
  if (!inner) return { rejectionError: () => null };
  let err: Error | null = null;
  return {
    hostVerifier: (key: Buffer) => {
      const ok = inner(key);
      if (!ok) {
        err = new Error(
          `SSH host key for ${t.host} does not match the pinned key — refusing to connect ` +
          `(possible man-in-the-middle, or the device was re-imaged/replaced). ` +
          `Re-pin the device's host key if this change is expected.`);
      }
      return ok;
    },
    rejectionError: () => err
  };
}
