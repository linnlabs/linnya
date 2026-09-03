import {
  CHATGPT_PROVIDER_ACCOUNT_ID,
  type ProviderAccountOAuthCredential,
  type ProviderAccountRegistry,
  type ProviderAccountRequestCredential,
  type ProviderAccountRequestCredentialResolver,
} from '../../../definitions/providerAccount';
import {
  CHATGPT_OAUTH_CONFIG,
  type ChatGptOAuthTokenClient,
} from '../../chatgpt-authorization/definitions/chatGptOAuth';
import { createChatGptOAuthTokenClient } from '../../chatgpt-authorization/orchestration/createChatGptOAuthTokenClient';
import { providerAccountRegistry } from '../../account-persistence/orchestration/fileProviderAccountRegistry';

export interface ProviderAccountRequestCredentialResolverDependencies {
  readonly accounts: ProviderAccountRegistry;
  readonly chatGptTokens: ChatGptOAuthTokenClient;
  readonly now: () => number;
}

function projectChatGptRequestCredential(
  credential: ProviderAccountOAuthCredential
): ProviderAccountRequestCredential {
  return {
    access_token: credential.access_token,
    request_headers: {
      'chatgpt-account-id': credential.account_id,
      originator: 'linnya',
    },
  };
}

export function createProviderAccountRequestCredentialResolver(
  dependencies: ProviderAccountRequestCredentialResolverDependencies
): ProviderAccountRequestCredentialResolver {
  const refreshes = new Map<string, Promise<ProviderAccountOAuthCredential>>();

  return {
    async resolve(accountId) {
      if (accountId !== CHATGPT_PROVIDER_ACCOUNT_ID) {
        throw new Error(`尚未注册 Provider account request credential: ${accountId}`);
      }
      let credential = dependencies.accounts.resolveOAuthCredential(accountId);
      if (dependencies.now() < credential.expires_at - CHATGPT_OAUTH_CONFIG.refresh_buffer_ms) {
        return projectChatGptRequestCredential(credential);
      }
      let refresh = refreshes.get(accountId);
      if (!refresh) {
        refresh = (async () => {
          const refreshed = await dependencies.chatGptTokens.refreshCredential(credential);
          const account = dependencies.accounts.get(accountId);
          if (!account) throw new Error(`Provider account 不存在: ${accountId}`);
          await dependencies.accounts.putOAuthCredential(
            {
              id: account.id,
              provider_connection_definition_id: account.provider_connection_definition_id,
              auth_method: account.auth_method,
            },
            refreshed
          );
          return refreshed;
        })();
        refreshes.set(accountId, refresh);
      }
      try {
        credential = await refresh;
      } finally {
        if (refreshes.get(accountId) === refresh) refreshes.delete(accountId);
      }
      return projectChatGptRequestCredential(credential);
    },
  };
}

export const providerAccountRequestCredentialResolver =
  createProviderAccountRequestCredentialResolver({
    accounts: providerAccountRegistry,
    chatGptTokens: createChatGptOAuthTokenClient(),
    now: Date.now,
  });
