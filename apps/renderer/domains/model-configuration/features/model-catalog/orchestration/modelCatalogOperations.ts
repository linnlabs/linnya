import type { ModelCatalogItem, UpdateModelCommand } from '../definitions/modelCatalog';
import type { ModelCatalogGateway } from '../definitions/modelCatalogGateway';
import { createModelCatalogError } from '../functions/modelCatalogError';
import { httpModelCatalogGateway } from '../infrastructure/httpModelCatalogGateway';
import { useModelCatalogStore } from '../store/modelCatalogStore';

const operations = new WeakMap<ReturnType<typeof useModelCatalogStore>, Promise<void>>();

function enqueue<T>(
  store: ReturnType<typeof useModelCatalogStore>,
  execute: () => Promise<T>
): Promise<T> {
  const result = (operations.get(store) ?? Promise.resolve()).then(execute);
  operations.set(
    store,
    result.then(
      () => undefined,
      () => undefined
    )
  );
  return result;
}

/** 后台读取参与同一顺序，但不覆盖用户操作的错误状态。 */
export function synchronizeModelCatalogSnapshot(
  gateway: ModelCatalogGateway = httpModelCatalogGateway
): Promise<void> {
  const store = useModelCatalogStore();
  return enqueue(store, async () => store.replaceSnapshot(await gateway.load()));
}

export async function loadModelCatalog(
  gateway: ModelCatalogGateway = httpModelCatalogGateway
): Promise<void> {
  const store = useModelCatalogStore();
  return enqueue(store, async () => {
    store.beginOperation('load');
    try {
      store.replaceSnapshot(await gateway.load());
      store.finishOperation();
    } catch (error) {
      store.failOperation(createModelCatalogError('load', error));
      throw error;
    }
  });
}

export async function updateModelInCatalog(
  modelId: string,
  command: UpdateModelCommand,
  gateway: ModelCatalogGateway = httpModelCatalogGateway
): Promise<ModelCatalogItem> {
  const store = useModelCatalogStore();
  return enqueue(store, async () => {
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
  });
}

export async function deleteModelFromCatalog(
  modelId: string,
  gateway: ModelCatalogGateway = httpModelCatalogGateway
): Promise<void> {
  const store = useModelCatalogStore();
  return enqueue(store, async () => {
    store.beginOperation('delete');
    try {
      await gateway.delete(modelId);
      store.removeModel(modelId);
      store.finishOperation();
    } catch (error) {
      store.failOperation(createModelCatalogError('delete', error));
      throw error;
    }
  });
}
