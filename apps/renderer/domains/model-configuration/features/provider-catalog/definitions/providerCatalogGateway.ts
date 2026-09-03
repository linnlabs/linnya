import type { ProviderCatalogListResponse } from '@app/schemas/provider-catalog';

export interface ProviderCatalogGateway {
  load(): Promise<ProviderCatalogListResponse>;
}
