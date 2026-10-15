import {
  ModelPickerSourceSynchronizationError,
  type ModelPickerOperation,
  type ModelPickerOperationError,
} from '../definitions/modelPicker';

export function createModelPickerOperationError(
  operation: ModelPickerOperation,
  error: unknown,
  sourceLabel?: string
): ModelPickerOperationError {
  if (error instanceof ModelPickerSourceSynchronizationError) {
    return {
      operation,
      detail: null,
      outcome: 'source-refreshed-synchronization-failed',
      sourceLabel: error.sourceLabel,
    };
  }
  const detail = error instanceof Error && error.message.trim() ? error.message : null;
  return {
    operation,
    detail: sourceLabel && detail ? `${sourceLabel}: ${detail}` : detail,
  };
}
