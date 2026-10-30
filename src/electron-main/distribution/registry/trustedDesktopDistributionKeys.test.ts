import { createPublicKey } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { trustedDesktopDistributionKeys } from './trustedDesktopDistributionKeys';

describe('trustedDesktopDistributionKeys', () => {
  it('只包含可解析的 Ed25519 公钥', () => {
    const entries = Object.entries(trustedDesktopDistributionKeys);
    expect(entries.length).toBeGreaterThan(0);
    for (const [keyId, publicKey] of entries) {
      expect(keyId).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(publicKey).not.toContain('PRIVATE');
      expect(createPublicKey(publicKey).asymmetricKeyType).toBe('ed25519');
    }
  });
});
