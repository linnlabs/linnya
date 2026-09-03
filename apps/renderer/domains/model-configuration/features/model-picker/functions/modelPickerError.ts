import type { ModelPickerOperation, ModelPickerOperationError } from '../definitions/modelPicker';

export function createModelPickerOperationError(
  operation: ModelPickerOperation,
  error: unknown
): ModelPickerOperationError {
  return {
    operation,
    detail: error instanceof Error && error.message.trim() ? error.message : null,
  };
}
