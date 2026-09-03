import type {
  LlmRequestMessage,
  ResolvedLlmInputMessage,
} from '../../../../ports';
import {
  deriveModelInputRequirement,
  MODEL_INPUT_ERROR_CODES,
  ModelInputCapabilityError,
} from '../../input-capabilities';

function hasDurableAttachments(message: LlmRequestMessage): boolean {
  return 'attachments' in message
    && Array.isArray(message.attachments)
    && message.attachments.length > 0;
}

/**
 * 纯文本无需访问 host 资源。含附件消息必须等 materializer 装配完成后再进入 canonical request builder。
 */
export function liftTextOnlyLlmInput(
  activeModelId: string,
  messages: readonly LlmRequestMessage[],
): ResolvedLlmInputMessage[] {
  if (messages.some(hasDurableAttachments)) {
    const requirement = deriveModelInputRequirement(messages);
    throw new ModelInputCapabilityError(
      MODEL_INPUT_ERROR_CODES.MATERIALIZATION_PENDING,
      'Image input materialization is not available in this runtime.',
      {
        active_model_id: activeModelId,
        required_placements: requirement.placements,
        missing_conditions: ['materialization_pending'],
      },
    );
  }

  return messages.map((message) => {
    if ('attachments' in message) {
      const { attachments: _durableAttachments, ...messageWithoutAttachments } = message;
      return messageWithoutAttachments;
    }
    return message;
  });
}
