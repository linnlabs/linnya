import type { ModelPickerSnapshot } from '@app/schemas/model-picker';

import type { ModelPickerGateway } from '../definitions/modelPickerGateway';
import { createModelPickerOperationError } from '../functions/modelPickerError';
import { httpModelPickerGateway } from '../infrastructure/httpModelPickerGateway';
import { useModelPickerStore } from '../store/modelPickerStore';

async function runSnapshotOperation(
  operation: 'load' | 'provider-visibility' | 'model-visibility' | 'model-activation',
  execute: () => Promise<ModelPickerSnapshot>,
  sourceLabel?: string
): Promise<void> {
  const store = useModelPickerStore();
  store.beginOperation(operation);
  try {
    store.replaceSnapshot(await execute());
    store.finishOperation();
  } catch (error: unknown) {
    const failure = createModelPickerOperationError(operation, error);
    store.failOperation({
      ...failure,
      detail: sourceLabel && failure.detail ? `${sourceLabel}: ${failure.detail}` : failure.detail,
    });
    throw error;
  }
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
  const snapshot = await gateway.load();
  useModelPickerStore().replaceSnapshot(snapshot);
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
  refreshSource: () => Promise<void>,
  gateway: ModelPickerGateway = httpModelPickerGateway
): Promise<void> {
  return runSnapshotOperation(
    'load',
    async () => {
      await refreshSource();
      return gateway.load();
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
