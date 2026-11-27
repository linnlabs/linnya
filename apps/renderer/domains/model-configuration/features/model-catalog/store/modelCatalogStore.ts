import { defineStore } from 'pinia';
import { ref } from 'vue';

import type {
  ModelCatalogError,
  ModelCatalogItem,
  ModelCatalogOperation,
  ModelCatalogSnapshot,
} from '../definitions/modelCatalog';

export const useModelCatalogStore = defineStore('modelCatalog', () => {
  const models = ref<ModelCatalogItem[]>([]);
  const activeOperation = ref<ModelCatalogOperation | null>(null);
  const error = ref<ModelCatalogError | null>(null);

  function beginOperation(operation: ModelCatalogOperation): void {
    activeOperation.value = operation;
    error.value = null;
  }

  function finishOperation(): void {
    activeOperation.value = null;
  }

  function failOperation(nextError: ModelCatalogError): void {
    activeOperation.value = null;
    error.value = nextError;
  }

  function replaceSnapshot(snapshot: ModelCatalogSnapshot): void {
    models.value = [...snapshot.models];
  }

  function replaceModel(model: ModelCatalogItem): void {
    const index = models.value.findIndex(candidate => candidate.id === model.id);
    if (index === -1) throw new Error(`待更新模型不在目录中：${model.id}`);
    models.value[index] = model;
  }

  function replaceModels(nextModels: readonly ModelCatalogItem[]): void {
    models.value = [...nextModels];
  }

  function removeModel(modelId: string): void {
    const index = models.value.findIndex(model => model.id === modelId);
    if (index === -1) throw new Error(`待删除模型不在目录中：${modelId}`);
    models.value.splice(index, 1);
  }

  return {
    models,
    activeOperation,
    error,
    beginOperation,
    finishOperation,
    failOperation,
    replaceSnapshot,
    replaceModel,
    replaceModels,
    removeModel,
  };
});
