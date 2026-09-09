import { describe, expect, it, vi } from 'vitest';

import type {
  ProviderAccount,
  ProviderAccountOAuthCredential,
  ProviderAccountRegistry,
} from 'src/domains/provider-account';
import type {
  ExternalAuthorizationBrowserPort,
  OAuthLoopbackPort,
} from '../definitions/providerAccountAuthorization';
import { createProviderAccountAuthorizationUseCase } from './createProviderAccountAuthorizationUseCase';

describe('Provider account authorization use case', () => {
  it('先建立固定 loopback，再打开 ChatGPT，并把 token 只交给账号 registry', async () => {
    let storedAccount: ProviderAccount | undefined;
    let storedCredential: ProviderAccountOAuthCredential | undefined;
    const putOAuthCredential = vi.fn<ProviderAccountRegistry['putOAuthCredential']>(
      async (account, credential) => {
        storedCredential = credential;
        const createdAccount: ProviderAccount = {
          ...account,
          created_at: '2026-08-21T00:00:00.000Z',
          updated_at: '2026-08-21T00:00:00.000Z',
        };
        storedAccount = createdAccount;
        return createdAccount;
      }
    );
    const accounts: ProviderAccountRegistry = {
      installCredentialCodec: vi.fn(),
      initialize: vi.fn(async () => undefined),
      list: () => (storedAccount ? [storedAccount] : []),
      get: () => storedAccount,
      hasCredential: () => storedCredential !== undefined,
      getCredentialStatus: () => storedCredential ? 'available' : 'missing',
      resolveOAuthCredential: () => {
        if (!storedCredential) throw new Error('fixture credential missing');
        return storedCredential;
      },
      putOAuthCredential,
      remove: vi.fn(async () => {
        storedAccount = undefined;
        storedCredential = undefined;
      }),
    };
    const close = vi.fn(async () => undefined);
    const loopback: OAuthLoopbackPort = {
      listen: vi.fn(async () => ({
        authorization_code: Promise.resolve('authorization-code'),
        close,
      })),
    };
    const browser: ExternalAuthorizationBrowserPort = { open: vi.fn(async () => undefined) };
    const synchronizeConnectedProviderModels = vi.fn(async () => undefined);
    const synchronizeAccountModels = vi.fn();
    const removeAccountModels = vi.fn();
    const credential: ProviderAccountOAuthCredential = {
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_at: 1_800_000_000_000,
      account_id: 'upstream-account',
    };
    const useCase = createProviderAccountAuthorizationUseCase({
      accounts,
      loopback,
      browser,
      chatGptTokens: {
        exchangeAuthorizationCode: vi.fn(async () => credential),
        refreshCredential: vi.fn(async current => current),
      },
      providerModels: { synchronizeConnectedProviderModels },
      accountModels: {
        synchronize: synchronizeAccountModels,
        remove: removeAccountModels,
      },
    });

    expect(useCase.getChatGptStatus().status).toBe('disconnected');
    await expect(useCase.authorizeChatGpt()).resolves.toEqual({
      account_id: 'chatgpt-subscription',
      provider_connection_definition_id: 'openai-chatgpt-subscription',
      status: 'connected',
    });
    expect(loopback.listen).toHaveBeenCalledOnce();
    expect(browser.open).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/auth\.openai\.com/)
    );
    expect(accounts.putOAuthCredential).toHaveBeenCalledWith(
      {
        id: 'chatgpt-subscription',
        provider_connection_definition_id: 'openai-chatgpt-subscription',
        auth_method: 'oauth_pkce',
      },
      credential
    );
    expect(close).toHaveBeenCalledOnce();
    expect(synchronizeAccountModels).toHaveBeenCalledWith(
      'openai-chatgpt-subscription',
      'chatgpt-subscription'
    );
    expect(synchronizeConnectedProviderModels).toHaveBeenCalledWith('openai-chatgpt-subscription');
    expect(useCase.getChatGptStatus().status).toBe('connected');

    await expect(useCase.disconnectChatGpt()).resolves.toMatchObject({
      status: 'disconnected',
    });
    expect(removeAccountModels).toHaveBeenCalledWith('chatgpt-subscription');
  });
});
