import type {
  ProviderCatalogGeneration,
  ProviderDefinition,
} from '@app/schemas/provider-catalog';
import type { Ref } from 'vue';

export interface ProviderCatalogReadModel {
  readonly providers: Readonly<Ref<readonly ProviderDefinition[]>>;
  readonly generation: Readonly<Ref<ProviderCatalogGeneration | null>>;
  readonly isLoading: Readonly<Ref<boolean>>;
  readonly error: Readonly<Ref<string | null>>;
}
