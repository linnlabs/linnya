import type { AiMessage } from '../../contracts';
import type {
  LlmImageInputEstimatorPort,
  LlmImageInputPlacement,
} from '../../ports';

export interface MessageImageInputEstimate {
  readonly activeModelId: string;
  readonly attachmentIndex: number;
  readonly attachmentId: string;
  readonly resourceId: string;
  readonly placement: LlmImageInputPlacement;
  readonly width: number;
  readonly height: number;
  readonly estimatedTokens: number;
  readonly profileId: string;
  readonly estimatorVersion: string;
}

export function estimateMessageImageInputs(params: {
  readonly message: AiMessage;
  readonly activeModelId?: string;
  readonly estimator?: LlmImageInputEstimatorPort;
}): MessageImageInputEstimate[] {
  if (!('attachments' in params.message) || !params.message.attachments?.length) return [];
  const activeModelId = params.activeModelId;
  const estimator = params.estimator;
  if (!activeModelId || !estimator) {
    throw new Error('Image input estimator is required for messages with attachments.');
  }

  const placement: LlmImageInputPlacement = params.message.role === 'tool'
    ? 'tool_result_image'
    : 'user_image';
  return params.message.attachments.map((attachment, attachmentIndex) => {
    const estimate = estimator.estimateImageInput(activeModelId, {
      id: attachment.id,
      resourceId: attachment.resourceId,
      mediaType: attachment.mediaType,
      byteLength: attachment.byteLength,
      width: attachment.width,
      height: attachment.height,
      placement,
    });
    return {
      activeModelId,
      attachmentIndex,
      attachmentId: attachment.id,
      resourceId: attachment.resourceId,
      placement,
      width: attachment.width,
      height: attachment.height,
      estimatedTokens: estimate.estimatedTokens,
      profileId: estimate.profileId,
      estimatorVersion: estimate.estimatorVersion,
    };
  });
}
