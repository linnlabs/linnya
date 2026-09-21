import { createHash } from 'node:crypto';

import { AsyncEntry } from '@napi-rs/keyring';

import {
  CredentialProtectionError,
  type CredentialProtectionPort,
} from '../../../../../shared/credential-protection';
import type {
  SystemKeyringEntry,
  SystemKeyringEntryFactory,
} from '../definitions/systemKeyring';
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
      // @napi-rs/keyring 的 macOS 原生实现对不存在的条目实际返回 null，
      // 虽然 2.x 声明文件写的是 undefined。先在 adapter 边界归一化，避免
      // 下游把“缺失”当成密钥内容交给 Buffer.from 或密文解码器。
      getSecret: async () => (await entry.getSecret()) ?? undefined,
      getPassword: async () => (await entry.getPassword()) ?? undefined,
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
      const stored = await readStoredMasterKey(entry);
      if (stored !== undefined) return decodeSystemCredentialMasterKey(stored);
      if (!input.allowMasterKeyCreation) {
        throw new CredentialProtectionError('temporarily_unavailable');
      }
      const created = createSystemCredentialMasterKey();
      try {
        await entry.setPassword(encodeSystemCredentialMasterKey(created));
        const persisted = await readStoredMasterKey(entry);
        if (persisted === undefined) throw new CredentialProtectionError('temporarily_unavailable');
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

/**
 * 新版 keyring 用 getSecret 保留存储错误；旧版本写的是 password 记录，
 * 因此只有在 secret 明确不存在时才走兼容读取。两种读取都失败时不能
 * 被解释成“缺失”，否则 Desktop 可能覆盖原 master key。
 */
async function readStoredMasterKey(
  entry: SystemKeyringEntry,
): Promise<string | undefined> {
  let secret: Uint8Array | undefined;
  try {
    secret = await entry.getSecret();
  } catch {
    throw new CredentialProtectionError('temporarily_unavailable');
  }
  if (secret !== undefined && secret !== null) return Buffer.from(secret).toString('utf8');
  try {
    return (await entry.getPassword()) ?? undefined;
  } catch {
    throw new CredentialProtectionError('temporarily_unavailable');
  }
}
