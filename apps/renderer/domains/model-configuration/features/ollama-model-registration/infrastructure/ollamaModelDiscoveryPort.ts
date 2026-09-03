import { fetchOllamaModels } from '@shared/services/aiService/index.js';
import { isOllamaModelFetchError } from '@shared/services/aiService/ollamaModelFetchError';

import { OllamaModelDiscoveryError } from '../definitions/ollamaModelDiscoveryError';
import type { OllamaModelDiscoveryPort } from '../definitions/ollamaModelRegistrationGateway';

const listOllamaModels: (serviceUrl: string) => Promise<string[]> = fetchOllamaModels;

export function createOllamaModelDiscoveryPort(): OllamaModelDiscoveryPort {
  return {
    async listModels(serviceUrl): Promise<readonly string[]> {
      try {
        return await listOllamaModels(serviceUrl);
      } catch (error) {
        if (!isOllamaModelFetchError(error)) throw error;
        throw new OllamaModelDiscoveryError({
          code: error.code,
          target: error.target,
          statusCode: error.statusCode,
        });
      }
    },
  };
}
