import { createHash } from 'node:crypto';

import { AsyncEntry } from '@napi-rs/keyring';

import {
  CredentialProtectionError,
  type CredentialProtectionPort,
} from '../../../../../shared/credential-protection';
import type { SystemKeyringEntryFactory } from '../definitions/systemKeyring';
import {
  createSystemCredentialMasterKey,
  decodeSystemCredentialMasterKey,
  decryptSystemCredential,
  encodeSystemCredentialMasterKey,
  encryptSystemCredential,
} from '../functions/systemCredentialCiphertext';

const KEYRING_SERVICE = 'com.linnlabs.linnya.credential-protection';

const defaultEntryFactory: SystemKeyringEntryFactory = {
  create(service, account) {
    const entry = new AsyncEntry(service, account);
    return {
      getPassword: () => entry.getPassword(),
      setPassword: password => entry.setPassword(password),
    };
  },
};

/**
 * Desktop 与独立 CLI 共用的系统密钥 adapter。业务文件继续只保存 AES-GCM 密文，
 * 32-byte master key 只进入当前 OS 用户的 keyring；CLI 不负责首次创建信任根。
 */
export function createSystemCredentialProtectionPort(input: {
  readonly vaultId: string;
  readonly allowMasterKeyCreation: boolean;
  readonly entryFactory?: SystemKeyringEntryFactory;
}): CredentialProtectionPort {
  const normalizedVaultId = input.vaultId.trim();
  if (!normalizedVaultId) throw new Error('Credential protection vaultId 不能为空');
  const account = `master-key-v1:${createHash('sha256').update(normalizedVaultId).digest('hex')}`;
  const entry = (input.entryFactory ?? defaultEntryFactory).create(KEYRING_SERVICE, account);
  let masterKeySettlement: Promise<Buffer> | null = null;

  const resolveMasterKey = (): Promise<Buffer> => {
    if (masterKeySettlement) return masterKeySettlement;
    masterKeySettlement = (async () => {
      let stored: string | undefined;
      try {
        stored = await entry.getPassword();
      } catch {
        throw new CredentialProtectionError('temporarily_unavailable');
      }
      if (stored) return decodeSystemCredentialMasterKey(stored);
      if (!input.allowMasterKeyCreation) {
        throw new CredentialProtectionError('temporarily_unavailable');
      }
      const created = createSystemCredentialMasterKey();
      try {
        await entry.setPassword(encodeSystemCredentialMasterKey(created));
        const persisted = await entry.getPassword();
        if (!persisted) throw new CredentialProtectionError('temporarily_unavailable');
        return decodeSystemCredentialMasterKey(persisted);
      } catch (error: unknown) {
        if (error instanceof CredentialProtectionError) throw error;
        throw new CredentialProtectionError('temporarily_unavailable');
      }
    })().catch((error: unknown) => {
      masterKeySettlement = null;
      throw error;
    });
    return masterKeySettlement;
  };

  return Object.freeze({
    async encrypt(plaintext: string) {
      return encryptSystemCredential(plaintext, await resolveMasterKey());
    },
    async decrypt(ciphertext: string) {
      return decryptSystemCredential(ciphertext, await resolveMasterKey());
    },
    async rewrap() {
      return undefined;
    },
  });
}
