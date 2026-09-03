import type {
  ModelCatalogItem,
  UpdateModelCommand,
} from '../definitions/modelCatalog';
import type { ModelCatalogGateway } from '../definitions/modelCatalogGateway';
import { createModelCatalogError } from '../functions/modelCatalogError';
import { httpModelCatalogGateway } from '../infrastructure/httpModelCatalogGateway';
import { useModelCatalogStore } from '../store/modelCatalogStore';

export async function loadModelCatalog(
  gateway: ModelCatalogGateway = httpModelCatalogGateway,
): Promise<void> {
  const store = useModelCatalogStore();
  store.beginOperation('load');
  try {
    store.replaceSnapshot(await gateway.load());
    store.finishOperation();
  } catch (error) {
    store.failOperation(createModelCatalogError('load', error));
    throw error;
  }
}

export async function updateModelInCatalog(
  modelId: string,
  command: UpdateModelCommand,
  gateway: ModelCatalogGateway = httpModelCatalogGateway,
): Promise<ModelCatalogItem> {
  const store = useModelCatalogStore();
  store.beginOperation('update');
  try {
    const model = await gateway.update(modelId, command);
    store.replaceModel(model);
    store.finishOperation();
    return model;
  } catch (error) {
    store.failOperation(createModelCatalogError('update', error));
    throw error;
  }
}

export async function deleteModelFromCatalog(
  modelId: string,
  gateway: ModelCatalogGateway = httpModelCatalogGateway,
): Promise<void> {
  const store = useModelCatalogStore();
  store.beginOperation('delete');
  try {
    await gateway.delete(modelId);
    store.removeModel(modelId);
    store.finishOperation();
  } catch (error) {
    store.failOperation(createModelCatalogError('delete', error));
    throw error;
  }
}
