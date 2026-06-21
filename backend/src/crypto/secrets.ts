import crypto from 'node:crypto';
import { config } from '../config.js';

// AES-256-GCM encryption for secrets at rest (device credentials, MFA secrets).
// Stored format: base64(iv) . base64(tag) . base64(ciphertext)

function keyBuf(hex: string): Buffer {
  const k = Buffer.from(hex, 'hex');
  if (k.length !== 32) throw new Error('credential key must be 32 bytes of hex (64 hex chars)');
  return k;
}

/** Encrypt with an explicit key (hex). The default helpers below use the
 *  configured key; this variant exists for credential-key rotation. */
export function encryptWith(keyHex: string, plaintext: string): string {
  if (!plaintext) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf(keyHex), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join('.');
}

/** Decrypt with an explicit key (hex). Throws if the key or auth tag don't verify. */
export function decryptWith(keyHex: string, stored: string): string {
  if (!stored) return '';
  const [ivB64, tagB64, ctB64] = stored.split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf(keyHex), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

/** Re-encrypt a stored secret from an old key to a new one (credential-key
 *  rotation). Decrypting with the wrong old key throws, so a bad key can't
 *  silently corrupt data. */
export function reencrypt(oldKeyHex: string, newKeyHex: string, stored: string): string {
  if (!stored) return '';
  return encryptWith(newKeyHex, decryptWith(oldKeyHex, stored));
}

export function encryptSecret(plaintext: string): string {
  return encryptWith(config.credentialKey, plaintext);
}

export function decryptSecret(stored: string): string {
  return decryptWith(config.credentialKey, stored);
}
