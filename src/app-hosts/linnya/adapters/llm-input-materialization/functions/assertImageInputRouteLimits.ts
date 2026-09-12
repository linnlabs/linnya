import {
  LLM_IMAGE_INPUT_ERROR_CODES,
  LlmImageInputError,
} from '@linnlabs/linnkit/runtime-kernel';
import type { ImageInputProcessingProfile } from '../definitions/imageInputProcessingProfile';
import type { DurableImageInputPosition } from './collectDurableImageInputs';

/** 所有 placement 共用整次 active route 的容量门禁，且必须在 Workspace 读取 bytes 前执行。 */
export function assertImageInputRouteLimits(params: {
  readonly activeModelId: string;
  readonly profile: ImageInputProcessingProfile;
  readonly inputs: readonly DurableImageInputPosition[];
}): void {
  const { limits } = params.profile;
  if (params.inputs.length > limits.maxImages) {
    throw new LlmImageInputError(
      LLM_IMAGE_INPUT_ERROR_CODES.ROUTE_LIMIT_EXCEEDED,
      'Image count exceeds the active route limit.',
      {
        active_model_id: params.activeModelId,
        profile_id: params.profile.id,
        limit_kind: 'image_count',
        actual_value: params.inputs.length,
        limit_value: limits.maxImages,
      },
    );
  }

  const maxImageEdgePixels = limits.maxImageEdgePixels?.(params.inputs.length);
  let totalBytes = 0;
  for (const input of params.inputs) {
    const identity = {
      active_model_id: params.activeModelId,
      placement: input.placement,
      message_id: input.messageId,
      attachment_id: input.reference.id,
      resource_id: input.reference.resourceId,
      message_index: input.messageIndex,
      attachment_index: input.attachmentIndex,
      profile_id: params.profile.id,
    };
    totalBytes += input.reference.byteLength;
    if (input.reference.byteLength > limits.maxImageBytes) {
      throw new LlmImageInputError(
        LLM_IMAGE_INPUT_ERROR_CODES.ROUTE_LIMIT_EXCEEDED,
        'Image bytes exceed the active route limit.',
        {
          ...identity,
          limit_kind: 'single_image_bytes',
          actual_value: input.reference.byteLength,
          limit_value: limits.maxImageBytes,
        },
      );
    }
    const actualEdgePixels = Math.max(input.reference.width, input.reference.height);
    if (maxImageEdgePixels !== undefined && actualEdgePixels > maxImageEdgePixels) {
      throw new LlmImageInputError(
        LLM_IMAGE_INPUT_ERROR_CODES.ROUTE_LIMIT_EXCEEDED,
        'Image edge pixels exceed the active route limit for this request image count.',
        {
          ...identity,
          // Linnkit 0.37.x 尚无尺寸 limit_kind；保持正式错误合同，不能冒充 byte 限制。
          actual_value: actualEdgePixels,
          limit_value: maxImageEdgePixels,
        },
      );
    }
  }
  if (totalBytes > limits.maxTotalImageBytes) {
    throw new LlmImageInputError(
      LLM_IMAGE_INPUT_ERROR_CODES.ROUTE_LIMIT_EXCEEDED,
      'Total image bytes exceed the active route limit.',
      {
        active_model_id: params.activeModelId,
        profile_id: params.profile.id,
        limit_kind: 'total_image_bytes',
        actual_value: totalBytes,
        limit_value: limits.maxTotalImageBytes,
      },
    );
  }
}
