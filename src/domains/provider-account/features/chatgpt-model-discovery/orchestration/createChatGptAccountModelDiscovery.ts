import type {
  ProviderAccountModelDiscovery,
  ProviderAccountRequestCredentialResolver,
} from '../../../definitions/providerAccount';
import { CHATGPT_MODEL_CATALOG_CONFIG } from '../definitions/chatGptModelCatalog';
import { readChatGptModelCatalogResponse } from '../functions/readChatGptModelCatalogResponse';

export interface ChatGptAccountModelDiscoveryDependencies {
  readonly credentials: ProviderAccountRequestCredentialResolver;
  readonly fetchImplementation: typeof fetch;
  readonly clientVersion: string;
}

export function createChatGptAccountModelDiscovery(
  dependencies: ChatGptAccountModelDiscoveryDependencies
): ProviderAccountModelDiscovery {
  return {
    async listModels(accountId) {
      const credential = await dependencies.credentials.resolve(accountId);
      const url = new URL(CHATGPT_MODEL_CATALOG_CONFIG.endpoint_url);
      url.searchParams.set('client_version', dependencies.clientVersion);
      const response = await dependencies.fetchImplementation(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${credential.access_token}`,
          'user-agent': `linnya/${dependencies.clientVersion}`,
          ...credential.request_headers,
        },
        signal: AbortSignal.timeout(CHATGPT_MODEL_CATALOG_CONFIG.request_timeout_ms),
      });
      if (!response.ok) {
        // 响应正文可能包含账号与套餐信息，不进入错误或日志。
        throw new Error(`ChatGPT /models 返回 HTTP ${response.status}`);
      }
      return readChatGptModelCatalogResponse(await response.json());
    },
  };
}
