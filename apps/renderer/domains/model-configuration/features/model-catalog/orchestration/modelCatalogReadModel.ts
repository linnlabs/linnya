import { storeToRefs } from 'pinia';

import type { ModelCatalogReadModel } from '../definitions/modelCatalogReadModel';
import { useModelCatalogStore } from '../store/modelCatalogStore';

export function useModelCatalogReadModel(): ModelCatalogReadModel {
  const { models, activeOperation, error, cloudModelsReady } = storeToRefs(useModelCatalogStore());
  return {
    models,
    activeOperation,
    error,
    cloudModelsReady,
  };
}
