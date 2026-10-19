import { storeToRefs } from 'pinia';

import type { ModelPickerReadModel } from '../definitions/modelPicker';
import { useModelPickerStore } from '../store/modelPickerStore';

export function useModelPickerReadModel(): ModelPickerReadModel {
  const { snapshot, activeOperation, error, managementProviderId } =
    storeToRefs(useModelPickerStore());
  return { snapshot, activeOperation, error, managementProviderId };
}

export function selectModelManagementProvider(configuredProviderId: string): void {
  useModelPickerStore().selectManagementProvider(configuredProviderId);
}
