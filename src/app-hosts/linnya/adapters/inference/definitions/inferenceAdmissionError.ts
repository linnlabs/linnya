export const INFERENCE_ADMISSION_ERROR_CODES = {
  MODEL_NOT_FOUND: 'inference.model_not_found',
  MODEL_NOT_CHAT: 'inference.model_not_chat',
  ROUTE_MISSING: 'inference.route_missing',
  CAPABILITY_MISSING: 'inference.capability_missing',
  CAPABILITY_ROUTE_MISMATCH: 'inference.capability_route_mismatch',
  OUTPUT_LIMIT_EXCEEDED: 'inference.output_limit_exceeded',
  IMAGE_PLACEMENT_UNSUPPORTED: 'inference.image_placement_unsupported',
  TOOL_CHOICE_UNKNOWN: 'inference.tool_choice_unknown',
  DUPLICATE_TOOL_NAME: 'inference.duplicate_tool_name',
  CREDENTIAL_INVALID: 'inference.credential_invalid',
  EVENT_ROUTE_MISMATCH: 'inference.event_route_mismatch',
  USAGE_UNAVAILABLE: 'inference.usage_unavailable',
} as const;

export type InferenceAdmissionErrorCode =
  (typeof INFERENCE_ADMISSION_ERROR_CODES)[keyof typeof INFERENCE_ADMISSION_ERROR_CODES];

export class InferenceAdmissionError extends Error {
  readonly errorCode: InferenceAdmissionErrorCode;
  readonly recoverable = false;

  constructor(
    readonly code: InferenceAdmissionErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'InferenceAdmissionError';
    this.errorCode = code;
  }
}
