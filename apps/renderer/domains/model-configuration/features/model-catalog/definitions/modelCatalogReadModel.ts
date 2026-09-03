import type { Ref } from 'vue';

import type {
  ModelCatalogError,
  ModelCatalogItem,
  ModelCatalogOperation,
} from './modelCatalog';

export interface ModelCatalogReadModel {
  readonly models: Readonly<Ref<readonly ModelCatalogItem[]>>;
  readonly activeOperation: Readonly<Ref<ModelCatalogOperation | null>>;
  readonly error: Readonly<Ref<ModelCatalogError | null>>;
  readonly cloudModelsReady: Readonly<Ref<boolean>>;
}
