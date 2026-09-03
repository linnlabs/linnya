import { ProviderCatalogListResponseSchema } from '@app/schemas/provider-catalog';
import { apiFetch, getApiBaseUrl } from '@shared/services/localApiClient';
import type { ProviderCatalogGateway } from '../definitions/providerCatalogGateway';

export const httpProviderCatalogGateway: ProviderCatalogGateway = {
  async load() {
    const baseUrl = await getApiBaseUrl();
    const response = await apiFetch(`${baseUrl}/api/v1/providers`);
    if (!response.ok) {
      throw new Error(`加载 Provider Catalog 失败（HTTP ${response.status}）`);
    }
    return ProviderCatalogListResponseSchema.parse(await response.json());
  },
};
