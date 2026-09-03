import type { ProviderCatalogGateway } from '../definitions/providerCatalogGateway';
import { httpProviderCatalogGateway } from '../infrastructure/httpProviderCatalogGateway';
import { useProviderCatalogStore } from '../store/providerCatalogStore';

export async function loadProviderCatalog(
  gateway: ProviderCatalogGateway = httpProviderCatalogGateway
): Promise<void> {
  const store = useProviderCatalogStore();
  store.beginLoad();
  try {
    store.replaceCatalog(await gateway.load());
  } catch (error) {
    store.failLoad(error instanceof Error ? error.message : '加载 Provider Catalog 失败');
    throw error;
  }
}
