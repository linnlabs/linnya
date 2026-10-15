import type { ModelPickerSnapshot } from '@app/schemas/model-picker';

import type { ModelPickerGateway } from '../definitions/modelPickerGateway';
import { ModelPickerSourceSynchronizationError } from '../definitions/modelPicker';
import { createModelPickerOperationError } from '../functions/modelPickerError';
import {
  removeCommittedPickerModels,
  removeCommittedPickerProvider,
} from '../functions/removeCommittedPickerModels';
import { httpModelPickerGateway } from '../infrastructure/httpModelPickerGateway';
import { useModelPickerStore } from '../store/modelPickerStore';

// 队列属于当前 Pinia 实例，页面重载、测试或第二个应用实例不共享任务。
const operations = new WeakMap<ReturnType<typeof useModelPickerStore>, Promise<void>>();

function enqueue(
  store: ReturnType<typeof useModelPickerStore>,
  execute: () => Promise<void>
): Promise<void> {
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

function applyCommittedRemovals(
  store: ReturnType<typeof useModelPickerStore>,
  removedModelIds: readonly string[]
): void {
  if (store.snapshot) {
    store.replaceSnapshot(removeCommittedPickerModels(store.snapshot, removedModelIds));
  }
}

export function removeCommittedModelsFromPicker(removedModelIds: readonly string[]): Promise<void> {
  const store = useModelPickerStore();
  return enqueue(store, async () => applyCommittedRemovals(store, removedModelIds));
}

export function removeCommittedCustomProviderFromPicker(
  providerName: string,
  removedModelIds: readonly string[]
): Promise<void> {
  const store = useModelPickerStore();
  return enqueue(store, async () => {
    if (store.snapshot) {
      store.replaceSnapshot(removeCommittedPickerProvider(store.snapshot, providerName, removedModelIds));
    }
  });
}

async function runSnapshotOperation(
  operation: 'load' | 'provider-visibility' | 'model-visibility' | 'model-activation',
  execute: () => Promise<ModelPickerSnapshot>,
  sourceLabel?: string
): Promise<void> {
  const store = useModelPickerStore();
  return enqueue(store, async () => {
    store.beginOperation(operation);
    try {
      store.replaceSnapshot(await execute());
      store.finishOperation();
    } catch (error: unknown) {
      store.failOperation(createModelPickerOperationError(operation, error, sourceLabel));
      throw error;
    }
  });
}

export async function loadModelPicker(
  gateway: ModelPickerGateway = httpModelPickerGateway
): Promise<void> {
  return runSnapshotOperation('load', () => gateway.load());
}

/** 后台失效通知只重读快照；它不能替用户的失败操作清除错误或结束进行中的刷新。 */
export async function synchronizeModelPickerSnapshot(
  gateway: ModelPickerGateway = httpModelPickerGateway
): Promise<void> {
  const store = useModelPickerStore();
  return enqueue(store, async () => store.replaceSnapshot(await gateway.load()));
}

export function refreshModelPickerProvider(
  configuredProviderId: string,
  sourceLabel: string,
  gateway: ModelPickerGateway = httpModelPickerGateway
): Promise<void> {
  return runSnapshotOperation(
    'load',
    () => gateway.refreshProviderModels(configuredProviderId),
    sourceLabel
  );
}

/** 来源发现与快照重读共用一个错误生命周期，不能让 Vue 另存一份会遮住后续操作的错误。 */
export function refreshModelPickerSource(
  sourceLabel: string,
  refreshSource: () => Promise<readonly string[]>,
  synchronizeCatalog: () => Promise<void>,
  gateway: ModelPickerGateway = httpModelPickerGateway
): Promise<void> {
  const store = useModelPickerStore();
  return runSnapshotOperation(
    'load',
    async () => {
      const removedModelIds = await refreshSource();
      // 当前已在 Picker 队列内，不反向排队；删除投影先于任何可能失败的重读生效。
      applyCommittedRemovals(store, removedModelIds);
      // 提交与投影读取分阶段；两份目录都收口，不能把已完成的同步增删报成刷新失败。
      const [catalogRead, pickerRead] = await Promise.allSettled([
        synchronizeCatalog(),
        gateway.load(),
      ]);
      if (catalogRead.status === 'rejected' || pickerRead.status === 'rejected') {
        throw new ModelPickerSourceSynchronizationError(sourceLabel);
      }
      return pickerRead.value;
    },
    sourceLabel
  );
}

export function setModelPickerProviderVisibility(
  configuredProviderId: string,
  visible: boolean,
  gateway: ModelPickerGateway = httpModelPickerGateway
): Promise<void> {
  return runSnapshotOperation('provider-visibility', () =>
    gateway.setProviderVisibility(configuredProviderId, visible)
  );
}

export function setModelPickerModelVisibility(
  modelConfigId: string,
  visible: boolean,
  gateway: ModelPickerGateway = httpModelPickerGateway
): Promise<void> {
  return runSnapshotOperation('model-visibility', () =>
    gateway.setModelVisibility(modelConfigId, visible)
  );
}

export function activateModelPickerProviderModel(
  configuredProviderId: string,
  providerModelId: string,
  gateway: ModelPickerGateway = httpModelPickerGateway
): Promise<void> {
  return runSnapshotOperation('model-activation', () =>
    gateway.activateProviderModel(configuredProviderId, providerModelId)
  );
}
