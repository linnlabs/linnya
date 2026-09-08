import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pathState = vi.hoisted(() => ({ accountFilePath: '' }));

vi.mock('src/shared/utils/pathManager', () => ({
  pathManager: {
    getProviderAccountsConfigPath: () => pathState.accountFilePath,
  },
}));

import type { ProviderAccountCredentialCodec } from '../../../definitions/providerAccount';
import { FileProviderAccountRegistry } from './fileProviderAccountRegistry';

const codec: ProviderAccountCredentialCodec = {
  encrypt: async plaintext => Buffer.from(`encrypted:${plaintext}`, 'utf8').toString('base64'),
  decrypt: async ciphertext => {
    const decoded = Buffer.from(ciphertext, 'base64').toString('utf8');
    if (!decoded.startsWith('encrypted:')) throw new Error('测试密文格式无效');
    return decoded.slice('encrypted:'.length);
  },
};

describe('Provider account 加密持久化', () => {
  let temporaryRoot = '';

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-provider-accounts-'));
    pathState.accountFilePath = path.join(temporaryRoot, 'provider_accounts.json');
  });

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  it('账号元数据可见、OAuth 凭据只写密文并可跨启动解析', async () => {
    const firstRegistry = new FileProviderAccountRegistry();
    firstRegistry.installCredentialCodec(codec);
    await firstRegistry.initialize();
    const account = await firstRegistry.putOAuthCredential(
      {
        id: 'chatgpt-subscription',
        provider_connection_definition_id: 'openai-chatgpt-subscription',
        auth_method: 'oauth_pkce',
      },
      {
        access_token: 'access-secret',
        refresh_token: 'refresh-secret',
        id_token: 'id-secret',
        expires_at: 1_800_000_000_000,
        account_id: 'account-1',
        email: 'user@example.com',
      }
    );

    expect(account).toMatchObject({
      id: 'chatgpt-subscription',
      provider_connection_definition_id: 'openai-chatgpt-subscription',
      auth_method: 'oauth_pkce',
    });
    const persisted = await fs.readFile(pathState.accountFilePath, 'utf8');
    expect(persisted).not.toContain('access-secret');
    expect(persisted).not.toContain('refresh-secret');
    expect(persisted).not.toContain('user@example.com');
    expect((await fs.stat(pathState.accountFilePath)).mode & 0o777).toBe(0o600);

    const restartedRegistry = new FileProviderAccountRegistry();
    restartedRegistry.installCredentialCodec(codec);
    await restartedRegistry.initialize();
    expect(restartedRegistry.resolveOAuthCredential(account.id)).toEqual({
      access_token: 'access-secret',
      refresh_token: 'refresh-secret',
      id_token: 'id-secret',
      expires_at: 1_800_000_000_000,
      account_id: 'account-1',
      email: 'user@example.com',
    });
  });

  it('一次性把旧 ChatGPT 产品引用迁移到 OpenAI 品牌下的订阅 connection', async () => {
    await fs.writeFile(
      pathState.accountFilePath,
      JSON.stringify({
        version: '1.0.0',
        last_updated: '2026-08-21T00:00:00.000Z',
        accounts: [
          {
            id: 'chatgpt-subscription',
            provider_definition_id: 'chatgpt',
            auth_method: 'oauth_pkce',
            created_at: '2026-08-21T00:00:00.000Z',
            updated_at: '2026-08-21T00:00:00.000Z',
            encrypted_credential: Buffer.from(
              'encrypted:{"access_token":"access","refresh_token":"refresh","expires_at":1,"account_id":"account"}',
              'utf8'
            ).toString('base64'),
          },
        ],
      }),
      'utf8'
    );

    const registry = new FileProviderAccountRegistry();
    registry.installCredentialCodec(codec);
    await registry.initialize();

    expect(registry.get('chatgpt-subscription')).toMatchObject({
      provider_connection_definition_id: 'openai-chatgpt-subscription',
    });
    const persisted: unknown = JSON.parse(await fs.readFile(pathState.accountFilePath, 'utf8'));
    expect(persisted).toEqual(
      expect.objectContaining({
        version: '2.0.0',
        accounts: [
          expect.objectContaining({
            provider_connection_definition_id: 'openai-chatgpt-subscription',
          }),
        ],
      })
    );
  });

  it('单条 OAuth 密文失效不阻断初始化，重新授权后恢复可用', async () => {
    await fs.writeFile(
      pathState.accountFilePath,
      JSON.stringify({
        version: '2.0.0',
        last_updated: '2026-09-08T00:00:00.000Z',
        accounts: [
          {
            id: 'chatgpt-subscription',
            provider_connection_definition_id: 'openai-chatgpt-subscription',
            auth_method: 'oauth_pkce',
            created_at: '2026-09-08T00:00:00.000Z',
            updated_at: '2026-09-08T00:00:00.000Z',
            encrypted_credential: 'not-a-valid-test-ciphertext',
          },
        ],
      }),
      'utf8',
    );

    const registry = new FileProviderAccountRegistry();
    registry.installCredentialCodec(codec);
    await registry.initialize();

    expect(registry.list()).toHaveLength(1);
    expect(registry.getCredentialStatus('chatgpt-subscription')).toBe('invalidated');
    expect(registry.hasCredential('chatgpt-subscription')).toBe(false);
    expect(() => registry.resolveOAuthCredential('chatgpt-subscription')).toThrow(
      'Provider account credential 当前不可用: invalidated',
    );

    await registry.putOAuthCredential(
      {
        id: 'chatgpt-subscription',
        provider_connection_definition_id: 'openai-chatgpt-subscription',
        auth_method: 'oauth_pkce',
      },
      {
        access_token: 'access-secret',
        refresh_token: 'refresh-secret',
        expires_at: 1_800_000_000_000,
        account_id: 'account-1',
      },
    );
    expect(registry.getCredentialStatus('chatgpt-subscription')).toBe('available');
    expect(registry.hasCredential('chatgpt-subscription')).toBe(true);
  });
});
