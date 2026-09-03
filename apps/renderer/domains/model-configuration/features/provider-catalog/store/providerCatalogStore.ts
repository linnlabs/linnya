import type {
  ProviderCatalogGeneration,
  ProviderCatalogListResponse,
  ProviderDefinition,
} from '@app/schemas/provider-catalog';
import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useProviderCatalogStore = defineStore('providerCatalog', () => {
  const providers = ref<ProviderDefinition[]>([]);
  const generation = ref<ProviderCatalogGeneration | null>(null);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  function beginLoad(): void {
    isLoading.value = true;
    error.value = null;
  }

  function replaceCatalog(response: ProviderCatalogListResponse): void {
    providers.value = [...response.providers];
    generation.value = response.generation;
    isLoading.value = false;
  }

  function failLoad(message: string): void {
    isLoading.value = false;
    error.value = message;
  }

  return { providers, generation, isLoading, error, beginLoad, replaceCatalog, failLoad };
});
