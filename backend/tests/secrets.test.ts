import { describe, it, expect } from 'vitest';
import { encryptWith, decryptWith, reencrypt } from '../src/crypto/secrets.js';

const K1 = 'a'.repeat(64);   // two distinct 32-byte (64 hex char) keys
const K2 = 'b'.repeat(64);

describe('secrets crypto', () => {
  it('round-trips with the same key and does not leak the plaintext', () => {
    const ct = encryptWith(K1, 'hunter2');
    expect(ct).not.toContain('hunter2');
    expect(ct.split('.')).toHaveLength(3);   // iv.tag.ciphertext
    expect(decryptWith(K1, ct)).toBe('hunter2');
  });

  it('uses a fresh IV so the same plaintext encrypts differently each time', () => {
    expect(encryptWith(K1, 'same')).not.toBe(encryptWith(K1, 'same'));
  });

  it('fails to decrypt with the wrong key', () => {
    expect(() => decryptWith(K2, encryptWith(K1, 'hunter2'))).toThrow();
  });

  it('reencrypt moves a secret from the old key to the new key', () => {
    const ct2 = reencrypt(K1, K2, encryptWith(K1, 's3cr3t'));
    expect(() => decryptWith(K1, ct2)).toThrow();      // old key no longer works
    expect(decryptWith(K2, ct2)).toBe('s3cr3t');       // new key does
  });

  it('treats empty input as empty (no-op)', () => {
    expect(encryptWith(K1, '')).toBe('');
    expect(decryptWith(K1, '')).toBe('');
    expect(reencrypt(K1, K2, '')).toBe('');
  });

  it('rejects a malformed key', () => {
    expect(() => encryptWith('tooshort', 'x')).toThrow(/32 bytes/);
  });
});
