import {
  LlmModelEligibilityError,
  MODEL_INPUT_ERROR_CODES,
  ModelInputCapabilityError,
  type ModelInputErrorMetadata,
} from '../definitions/modelInputCapabilityError';
import type {
  ModelInputCompatibility,
  ModelInputRequirement,
} from '../definitions/modelInputCapability';

export function createModelInputCompatibilityError(input: {
  readonly modelId: string;
  readonly requirement: ModelInputRequirement;
  readonly incompatibility: Exclude<ModelInputCompatibility, { readonly compatible: true }>;
  readonly compatibleModelIds?: readonly string[];
}): ModelInputCapabilityError | LlmModelEligibilityError {
  const metadata: ModelInputErrorMetadata = {
    active_model_id: input.modelId,
    required_placements: input.requirement.placements,
    missing_conditions: [input.incompatibility.reason],
    ...(input.compatibleModelIds
      ? { compatible_model_ids: input.compatibleModelIds }
      : {}),
  };

  if (input.incompatibility.reason === 'image_input_unsupported') {
    return new ModelInputCapabilityError(
      MODEL_INPUT_ERROR_CODES.MODEL_UNSUPPORTED,
      '当前模型不支持图片输入',
      metadata,
    );
  }

  if (input.incompatibility.reason === 'placement_unsupported') {
    return new ModelInputCapabilityError(
      MODEL_INPUT_ERROR_CODES.PLACEMENT_UNSUPPORTED,
      '当前模型连接不支持请求中的图片来源',
      metadata,
    );
  }

  return new LlmModelEligibilityError(
    '当前模型不可用于聊天调用',
    metadata,
  );
}
