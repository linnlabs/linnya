import type { ModelInputPlacement } from './modelInputCapability';

export const MODEL_INPUT_ERROR_CODES = {
  MODEL_UNSUPPORTED: 'llm.image_input.model_unsupported',
  PLACEMENT_UNSUPPORTED: 'llm.image_input.placement_unsupported',
  MATERIALIZATION_PENDING: 'llm.image_input.materialization_pending',
} as const;

export type ModelInputErrorCode = typeof MODEL_INPUT_ERROR_CODES[keyof typeof MODEL_INPUT_ERROR_CODES];

export const LLM_MODEL_ELIGIBILITY_ERROR_CODE = 'llm.unsupported_capability' as const;

export interface ModelInputErrorMetadata {
  readonly active_model_id: string;
  readonly required_placements: readonly ModelInputPlacement[];
  readonly missing_conditions?: readonly string[];
  readonly compatible_model_ids?: readonly string[];
  readonly fallback_rejections?: readonly string[];
}

function freezeMetadata(metadata: ModelInputErrorMetadata): ModelInputErrorMetadata {
  return Object.freeze({
    ...metadata,
    required_placements: Object.freeze([...metadata.required_placements]),
    ...(metadata.missing_conditions
      ? { missing_conditions: Object.freeze([...metadata.missing_conditions]) }
      : {}),
    ...(metadata.compatible_model_ids
      ? { compatible_model_ids: Object.freeze([...metadata.compatible_model_ids]) }
      : {}),
    ...(metadata.fallback_rejections
      ? { fallback_rejections: Object.freeze([...metadata.fallback_rejections]) }
      : {}),
  });
}

export class ModelInputCapabilityError extends Error {
  readonly recoverable = false;
  readonly metadata: ModelInputErrorMetadata;

  constructor(
    readonly errorCode: ModelInputErrorCode,
    message: string,
    metadata: ModelInputErrorMetadata,
  ) {
    super(message);
    this.name = 'ModelInputCapabilityError';
    this.metadata = freezeMetadata(metadata);
  }
}

export class LlmModelEligibilityError extends Error {
  readonly errorCode = LLM_MODEL_ELIGIBILITY_ERROR_CODE;
  readonly recoverable = false;
  readonly metadata: ModelInputErrorMetadata;

  constructor(message: string, metadata: ModelInputErrorMetadata) {
    super(message);
    this.name = 'LlmModelEligibilityError';
    this.metadata = freezeMetadata(metadata);
  }
}
