import { describe, expect, it, vi } from 'vitest';

import type {
  ProviderAccount,
  ProviderAccountOAuthCredential,
  ProviderAccountRegistry,
} from '../../../definitions/providerAccount';
import { createProviderAccountRequestCredentialResolver } from './createProviderAccountRequestCredentialResolver';

describe('Provider account request credential resolver', () => {
  it('过期窗口内并发请求只刷新一次，并持久化轮换后的 refresh token', async () => {
    const account: ProviderAccount = {
      id: 'chatgpt-subscription',
      provider_connection_definition_id: 'openai-chatgpt-subscription',
      auth_method: 'oauth_pkce',
      created_at: '2026-08-21T00:00:00.000Z',
      updated_at: '2026-08-21T00:00:00.000Z',
    };
    const expired: ProviderAccountOAuthCredential = {
      access_token: 'expired-access',
      refresh_token: 'refresh-1',
      expires_at: 1_000,
      account_id: 'upstream-account',
    };
    const refreshed: ProviderAccountOAuthCredential = {
      access_token: 'fresh-access',
      refresh_token: 'refresh-2',
      expires_at: 10_000_000,
      account_id: 'upstream-account',
    };
    const putOAuthCredential = vi.fn<ProviderAccountRegistry['putOAuthCredential']>(
      async () => account
    );
    const accounts: ProviderAccountRegistry = {
      installCredentialCodec: vi.fn(),
      initialize: vi.fn(async () => undefined),
      list: () => [account],
      get: () => account,
      hasCredential: () => true,
      getCredentialStatus: () => 'available',
      resolveOAuthCredential: () => expired,
      putOAuthCredential,
      remove: vi.fn(async () => undefined),
    };
    const refreshCredential = vi.fn(async () => refreshed);
    const resolver = createProviderAccountRequestCredentialResolver({
      accounts,
      chatGptTokens: {
        exchangeAuthorizationCode: vi.fn(async () => refreshed),
        refreshCredential,
      },
      now: () => 2_000,
    });

    const credentials = await Promise.all([
      resolver.resolve(account.id),
      resolver.resolve(account.id),
    ]);

    expect(refreshCredential).toHaveBeenCalledOnce();
    expect(putOAuthCredential).toHaveBeenCalledOnce();
    expect(credentials).toEqual([
      {
        access_token: 'fresh-access',
        request_headers: {
          'chatgpt-account-id': 'upstream-account',
          originator: 'linnya',
        },
      },
      {
        access_token: 'fresh-access',
        request_headers: {
          'chatgpt-account-id': 'upstream-account',
          originator: 'linnya',
        },
      },
    ]);
  });
});
