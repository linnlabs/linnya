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
    async listModels(accountId, signal) {
      signal?.throwIfAborted();
      const credential = await dependencies.credentials.resolve(accountId);
      // 凭据刷新由账号 resolver 共享；目录取消等待其收口，不打断其他推理消费者。
      signal?.throwIfAborted();
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
        signal: AbortSignal.any([
          AbortSignal.timeout(CHATGPT_MODEL_CATALOG_CONFIG.request_timeout_ms),
          ...(signal ? [signal] : []),
        ]),
      });
      if (!response.ok) {
        // 响应正文可能包含账号与套餐信息，不进入错误或日志。
        throw new Error(`ChatGPT /models 返回 HTTP ${response.status}`);
      }
      return readChatGptModelCatalogResponse(await response.json());
    },
  };
}
