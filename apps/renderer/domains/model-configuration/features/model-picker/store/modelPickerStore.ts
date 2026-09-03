import type { ModelPickerSnapshot } from '@app/schemas/model-picker';
import { defineStore } from 'pinia';
import { ref } from 'vue';

import type { ModelPickerOperation, ModelPickerOperationError } from '../definitions/modelPicker';

export const useModelPickerStore = defineStore('modelPicker', () => {
  const snapshot = ref<ModelPickerSnapshot | null>(null);
  const activeOperation = ref<ModelPickerOperation | null>(null);
  const error = ref<ModelPickerOperationError | null>(null);

  function beginOperation(operation: ModelPickerOperation): void {
    activeOperation.value = operation;
    error.value = null;
  }

  function replaceSnapshot(nextSnapshot: ModelPickerSnapshot): void {
    snapshot.value = nextSnapshot;
  }

  function finishOperation(): void {
    activeOperation.value = null;
  }

  function failOperation(nextError: ModelPickerOperationError): void {
    activeOperation.value = null;
    error.value = nextError;
  }

  return {
    snapshot,
    activeOperation,
    error,
    beginOperation,
    replaceSnapshot,
    finishOperation,
    failOperation,
  };
});
