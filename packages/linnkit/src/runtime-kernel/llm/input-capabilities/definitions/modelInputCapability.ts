import type { LlmImageInputPlacement } from '../../../../ports';

export const MODEL_INPUT_PLACEMENTS = ['user_image', 'tool_result_image'] as const;

export type ModelInputPlacement = LlmImageInputPlacement;

export interface AdapterInputSupport {
  readonly user_image: boolean;
  readonly tool_result_image: boolean;
}

export interface ModelInputRequirement {
  readonly requires_image_input: boolean;
  readonly placements: readonly ModelInputPlacement[];
}

export type ModelInputIncompatibilityReason =
  | 'model_missing'
  | 'model_disabled'
  | 'chat_unsupported'
  | 'image_input_unsupported'
  | 'placement_unsupported';

export type ModelInputCompatibility =
  | { readonly compatible: true }
  | {
      readonly compatible: false;
      readonly reason: ModelInputIncompatibilityReason;
      readonly missing_placements: readonly ModelInputPlacement[];
    };

export const EMPTY_MODEL_INPUT_REQUIREMENT: ModelInputRequirement = Object.freeze({
  requires_image_input: false,
  placements: Object.freeze([]),
});
