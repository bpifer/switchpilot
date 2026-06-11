import crypto from 'node:crypto';
import { config } from '../config.js';

// AES-256-GCM encryption for device credentials at rest.
// Stored format: base64(iv) . base64(tag) . base64(ciphertext)

function key(): Buffer {
  const k = Buffer.from(config.credentialKey, 'hex');
  if (k.length !== 32) throw new Error('CREDENTIAL_KEY must be 32 bytes of hex (64 hex chars)');
  return k;
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join('.');
}

export function decryptSecret(stored: string): string {
  if (!stored) return '';
  const [ivB64, tagB64, ctB64] = stored.split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}
