import { storeToRefs } from 'pinia';

import type { ModelPickerReadModel } from '../definitions/modelPicker';
import { useModelPickerStore } from '../store/modelPickerStore';

export function useModelPickerReadModel(): ModelPickerReadModel {
  const { snapshot, activeOperation, error } = storeToRefs(useModelPickerStore());
  return { snapshot, activeOperation, error };
}
