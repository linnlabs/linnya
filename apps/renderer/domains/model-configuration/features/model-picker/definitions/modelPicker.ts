import type { ModelPickerSnapshot } from '@app/schemas/model-picker';

export type ModelPickerOperation =
  | 'load'
  | 'provider-visibility'
  | 'model-visibility'
  | 'model-activation';

interface ModelPickerOperationErrorBase {
  readonly operation: ModelPickerOperation;
  readonly detail: string | null;
}

export type ModelPickerOperationError = ModelPickerOperationErrorBase &
  (
    | { readonly outcome?: undefined }
    | {
        readonly outcome: 'source-refreshed-synchronization-failed';
        readonly sourceLabel: string;
      }
  );

/** 来源提交已成功，后续读取失败必须保留这一事实，避免用户误判并重复提交。 */
export class ModelPickerSourceSynchronizationError extends Error {
  constructor(readonly sourceLabel: string) {
    super('模型已刷新，但列表同步失败');
    this.name = 'ModelPickerSourceSynchronizationError';
  }
}

export interface ModelPickerReadModel {
  readonly managementProviderId: Readonly<import('vue').Ref<string | null>>;
  readonly snapshot: Readonly<import('vue').Ref<ModelPickerSnapshot | null>>;
  readonly activeOperation: Readonly<import('vue').Ref<ModelPickerOperation | null>>;
  readonly error: Readonly<import('vue').Ref<ModelPickerOperationError | null>>;
}
