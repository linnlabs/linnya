import { storeToRefs } from 'pinia';
import type { ProviderCatalogReadModel } from '../definitions/providerCatalogReadModel';
import { useProviderCatalogStore } from '../store/providerCatalogStore';

export function useProviderCatalogReadModel(): ProviderCatalogReadModel {
  const { providers, generation, isLoading, error } = storeToRefs(useProviderCatalogStore());
  return { providers, generation, isLoading, error };
}
