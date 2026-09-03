import type { ModelPickerSnapshot } from '@app/schemas/model-picker';

import type { ModelPickerGateway } from '../definitions/modelPickerGateway';
import { createModelPickerOperationError } from '../functions/modelPickerError';
import { httpModelPickerGateway } from '../infrastructure/httpModelPickerGateway';
import { useModelPickerStore } from '../store/modelPickerStore';

async function runSnapshotOperation(
  operation: 'provider-visibility' | 'model-visibility' | 'model-activation',
  execute: () => Promise<ModelPickerSnapshot>
): Promise<void> {
  const store = useModelPickerStore();
  store.beginOperation(operation);
  try {
    store.replaceSnapshot(await execute());
    store.finishOperation();
  } catch (error: unknown) {
    store.failOperation(createModelPickerOperationError(operation, error));
    throw error;
  }
}

export async function loadModelPicker(
  gateway: ModelPickerGateway = httpModelPickerGateway
): Promise<void> {
  const store = useModelPickerStore();
  store.beginOperation('load');
  try {
    store.replaceSnapshot(await gateway.load());
    store.finishOperation();
  } catch (error: unknown) {
    store.failOperation(createModelPickerOperationError('load', error));
    throw error;
  }
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
