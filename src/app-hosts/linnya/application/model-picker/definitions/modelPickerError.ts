export type ModelPickerErrorCode =
  | 'model_picker.configured_provider_not_found'
  | 'model_picker.model_not_found'
  | 'model_picker.model_not_managed'
  | 'model_picker.provider_model_not_found';

export class ModelPickerError extends Error {
  constructor(
    readonly code: ModelPickerErrorCode,
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = 'ModelPickerError';
  }
}
