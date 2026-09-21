import { describe, expect, it } from 'vitest';

import { CredentialProtectionError } from '../../../../../shared/credential-protection';
import type { SystemKeyringEntryFactory } from '../definitions/systemKeyring';
import { createSystemCredentialProtectionPort } from '../orchestration/createSystemCredentialProtectionPort';

function createMemoryKeyring(): {
  readonly factory: SystemKeyringEntryFactory;
  readonly passwords: Map<string, Uint8Array>;
} {
  const passwords = new Map<string, Uint8Array>();
  return {
    passwords,
    factory: {
      create(service, account) {
        const key = `${service}\u0000${account}`;
        return {
          async getSecret() {
            const secret = passwords.get(key);
            return secret ? new Uint8Array(secret) : undefined;
          },
          async getPassword() {
            const secret = passwords.get(key);
            return secret ? Buffer.from(secret).toString('utf8') : undefined;
          },
          async setPassword(password) { passwords.set(key, Buffer.from(password, 'utf8')); },
        };
      },
    },
  };
}

describe('system credential protection', () => {
  it('让同一 vault 的 Desktop 与 CLI adapter 共享密文，但隔离不同 vault', async () => {
    const keyring = createMemoryKeyring();
    const desktop = createSystemCredentialProtectionPort({
      vaultId: '/app-data/a', allowMasterKeyCreation: true, entryFactory: keyring.factory,
    });
    const cli = createSystemCredentialProtectionPort({
      vaultId: '/app-data/a', allowMasterKeyCreation: false, entryFactory: keyring.factory,
    });
    const other = createSystemCredentialProtectionPort({
      vaultId: '/app-data/b', allowMasterKeyCreation: true, entryFactory: keyring.factory,
    });

    const ciphertext = await desktop.encrypt('密钥 secret');
    await expect(cli.decrypt(ciphertext)).resolves.toBe('密钥 secret');
    await expect(other.decrypt(ciphertext)).rejects.toMatchObject({ code: 'invalidated' });
    expect(ciphertext).not.toContain('secret');
  });

  it('CLI 不创建缺失的系统 master key，Desktop 并发加密只创建一次', async () => {
    const keyring = createMemoryKeyring();
    const cli = createSystemCredentialProtectionPort({
      vaultId: '/app-data/empty', allowMasterKeyCreation: false, entryFactory: keyring.factory,
    });
    await expect(cli.encrypt('secret')).rejects.toMatchObject({ code: 'temporarily_unavailable' });
    expect(keyring.passwords.size).toBe(0);

    const desktop = createSystemCredentialProtectionPort({
      vaultId: '/app-data/empty', allowMasterKeyCreation: true, entryFactory: keyring.factory,
    });
    const [first, second] = await Promise.all([desktop.encrypt('first'), desktop.encrypt('second')]);
    expect(keyring.passwords.size).toBe(1);
    await expect(desktop.decrypt(first)).resolves.toBe('first');
    await expect(desktop.decrypt(second)).resolves.toBe('second');
  });

  it('读取被系统拒绝时不把错误误判成缺失，也不覆盖已有 master key', async () => {
    let writes = 0;
    const port = createSystemCredentialProtectionPort({
      vaultId: '/app-data/denied',
      allowMasterKeyCreation: true,
      entryFactory: {
        create() {
          return {
            async getSecret() {
              throw new Error('keychain access denied');
            },
            async getPassword() {
              throw new Error('keychain access denied');
            },
            async setPassword() {
              writes += 1;
            },
          };
        },
      },
    });

    await expect(port.encrypt('secret')).rejects.toMatchObject({ code: 'temporarily_unavailable' });
    expect(writes).toBe(0);
  });

  it('兼容升级前以 password 形态保存的 master key', async () => {
    let password: string | undefined;
    const factory: SystemKeyringEntryFactory = {
      create() {
        return {
          async getSecret() { return undefined; },
          async getPassword() { return password; },
          async setPassword(next) { password = next; },
        };
      },
    };
    const desktop = createSystemCredentialProtectionPort({
      vaultId: '/app-data/legacy-password', allowMasterKeyCreation: true, entryFactory: factory,
    });
    const cli = createSystemCredentialProtectionPort({
      vaultId: '/app-data/legacy-password', allowMasterKeyCreation: false, entryFactory: factory,
    });

    const ciphertext = await desktop.encrypt('legacy-compatible');
    await expect(cli.decrypt(ciphertext)).resolves.toBe('legacy-compatible');
  });

  it('区分旧密文、损坏 envelope 与认证失败', async () => {
    const keyring = createMemoryKeyring();
    const port = createSystemCredentialProtectionPort({
      vaultId: '/app-data/a', allowMasterKeyCreation: true, entryFactory: keyring.factory,
    });
    await port.encrypt('seed');

    await expect(port.decrypt('legacy-base64')).rejects.toEqual(
      new CredentialProtectionError('migration_required'),
    );
    await expect(port.decrypt('linnya-keyring:v1:***')).rejects.toMatchObject({
      code: 'malformed_ciphertext',
    });
    const valid = await port.encrypt('secret');
    const prefix = 'linnya-keyring:v1:';
    const payload = valid.slice(prefix.length);
    // 修改首个 Base64URL 字符会稳定改变 nonce 字节；修改末字符可能只触及未使用的填充位。
    const tampered = `${prefix}${payload.startsWith('A') ? 'B' : 'A'}${payload.slice(1)}`;
    await expect(port.decrypt(tampered)).rejects.toMatchObject({ code: 'invalidated' });
  });
});
