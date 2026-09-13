import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { CredentialProtectionError } from '../../../../../shared/credential-protection';

const CIPHERTEXT_PREFIX = 'linnya-keyring:v1:';
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;
const AAD = Buffer.from('linnya-credential-protection:v1', 'utf8');

export function isSystemCredentialCiphertext(value: string): boolean {
  return value.startsWith(CIPHERTEXT_PREFIX);
}

export function createSystemCredentialMasterKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

export function encodeSystemCredentialMasterKey(key: Buffer): string {
  requireMasterKey(key);
  return `linnya-master-key:v1:${key.toString('base64url')}`;
}

export function decodeSystemCredentialMasterKey(value: string): Buffer {
  const prefix = 'linnya-master-key:v1:';
  if (!value.startsWith(prefix)) throw new CredentialProtectionError('invalidated');
  const key = decodeBase64Url(value.slice(prefix.length));
  requireMasterKey(key);
  return key;
}

export function encryptSystemCredential(plaintext: string, key: Buffer): string {
  requireMasterKey(key);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(AAD);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const payload = Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
  return `${CIPHERTEXT_PREFIX}${payload.toString('base64url')}`;
}

export function decryptSystemCredential(ciphertext: string, key: Buffer): string {
  requireMasterKey(key);
  if (!isSystemCredentialCiphertext(ciphertext)) {
    throw new CredentialProtectionError('migration_required');
  }
  const payload = decodeBase64Url(ciphertext.slice(CIPHERTEXT_PREFIX.length));
  if (payload.length < NONCE_BYTES + AUTH_TAG_BYTES) {
    throw new CredentialProtectionError('malformed_ciphertext');
  }
  const nonce = payload.subarray(0, NONCE_BYTES);
  const authTag = payload.subarray(NONCE_BYTES, NONCE_BYTES + AUTH_TAG_BYTES);
  const encrypted = payload.subarray(NONCE_BYTES + AUTH_TAG_BYTES);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(AAD);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    throw new CredentialProtectionError('invalidated');
  }
}

function decodeBase64Url(value: string): Buffer {
  if (!value || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new CredentialProtectionError('malformed_ciphertext');
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) {
    throw new CredentialProtectionError('malformed_ciphertext');
  }
  return decoded;
}

function requireMasterKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) throw new CredentialProtectionError('invalidated');
}
