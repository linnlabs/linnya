import {
  StorageSpaceErrorResponseSchema,
  StorageSpaceOverviewResponseSchema,
} from '@app/schemas';

import { apiFetch, getApiBaseUrl } from '@shared/services/aiService/common';
import {
  StorageSpaceGatewayError,
  type StorageSpaceGateway,
} from '../definitions/storageSpaceGateway';

interface StorageSpaceGatewayDependencies {
  readonly getBaseUrl: () => Promise<string>;
  readonly fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

export function createStorageSpaceGateway(
  dependencies: StorageSpaceGatewayDependencies,
): StorageSpaceGateway {
  return Object.freeze({
    async readOverview() {
      const baseUrl = await dependencies.getBaseUrl();
      const response = await dependencies.fetch(`${baseUrl}/api/v1/storage-space/overview`);
      if (!response.ok) {
        const error = StorageSpaceErrorResponseSchema.parse(await response.json());
        throw new StorageSpaceGatewayError(error.code);
      }
      return StorageSpaceOverviewResponseSchema.parse(await response.json());
    },

    async clearConversationWorkDirectory(conversationId: string) {
      const baseUrl = await dependencies.getBaseUrl();
      const response = await dependencies.fetch(
        `${baseUrl}/api/v1/storage-space/conversations/${encodeURIComponent(conversationId)}/work-directory`,
        { method: 'DELETE' },
      );
      if (response.status === 204) return;
      const error = StorageSpaceErrorResponseSchema.parse(await response.json());
      throw new StorageSpaceGatewayError(error.code);
    },
  });
}

export const storageSpaceGateway = createStorageSpaceGateway({
  getBaseUrl: getApiBaseUrl,
  fetch: apiFetch,
});
