import type { ModelPickerSnapshot } from '@app/schemas/model-picker';

export type ModelPickerOperation =
  | 'load'
  | 'provider-visibility'
  | 'model-visibility'
  | 'model-activation';

export interface ModelPickerOperationError {
  readonly operation: ModelPickerOperation;
  readonly detail: string | null;
}

export interface ModelPickerReadModel {
  readonly snapshot: Readonly<import('vue').Ref<ModelPickerSnapshot | null>>;
  readonly activeOperation: Readonly<import('vue').Ref<ModelPickerOperation | null>>;
  readonly error: Readonly<import('vue').Ref<ModelPickerOperationError | null>>;
}
