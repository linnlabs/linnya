import type { LlmImageInputPlacement } from '../ports';

export const LLM_IMAGE_INPUT_ERROR_CODES = {
  ATTACHMENT_UNAVAILABLE: 'llm.image_input.attachment_unavailable',
  ATTACHMENT_INTEGRITY_FAILED: 'llm.image_input.attachment_integrity_failed',
  ROUTE_LIMIT_EXCEEDED: 'llm.image_input.route_limit_exceeded',
  MAPPING_UNSUPPORTED: 'llm.image_input.mapping_unsupported',
  CONTEXT_BUDGET_EXCEEDED: 'llm.image_input.context_budget_exceeded',
} as const;

export type LlmImageInputErrorCode = typeof LLM_IMAGE_INPUT_ERROR_CODES[keyof typeof LLM_IMAGE_INPUT_ERROR_CODES];

export type LlmImageInputLimitKind =
  | 'image_count'
  | 'single_image_bytes'
  | 'total_image_bytes'
  | 'context_tokens';

export interface LlmImageInputErrorMetadata {
  readonly active_model_id: string;
  readonly placement?: LlmImageInputPlacement;
  readonly message_id?: string;
  readonly attachment_id?: string;
  readonly resource_id?: string;
  readonly message_index?: number;
  readonly attachment_index?: number;
  readonly profile_id?: string;
  readonly limit_kind?: LlmImageInputLimitKind;
  readonly actual_value?: number;
  readonly limit_value?: number;
}

/** context build 与 provider preflight 共用的结构化图片输入错误。 */
export class LlmImageInputError extends Error {
  readonly recoverable = false;
  readonly metadata: Readonly<LlmImageInputErrorMetadata>;

  constructor(
    readonly errorCode: LlmImageInputErrorCode,
    message: string,
    metadata: LlmImageInputErrorMetadata,
  ) {
    super(message);
    this.name = 'LlmImageInputError';
    this.metadata = Object.freeze({ ...metadata });
  }
}
