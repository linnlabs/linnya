import type { LlmRequestMessage } from '../../../../ports';
import {
  EMPTY_MODEL_INPUT_REQUIREMENT,
  type ModelInputPlacement,
  type ModelInputRequirement,
} from '../definitions/modelInputCapability';

function hasAttachments(message: LlmRequestMessage): boolean {
  return 'attachments' in message
    && Array.isArray(message.attachments)
    && message.attachments.length > 0;
}

export function deriveModelInputRequirement(
  messages: readonly LlmRequestMessage[],
): ModelInputRequirement {
  let hasUserImage = false;
  let hasToolResultImage = false;

  for (const message of messages) {
    if (!hasAttachments(message)) continue;
    if (message.role === 'user') hasUserImage = true;
    if (message.role === 'tool') hasToolResultImage = true;
  }

  if (!hasUserImage && !hasToolResultImage) {
    return EMPTY_MODEL_INPUT_REQUIREMENT;
  }

  const placements: ModelInputPlacement[] = [];
  if (hasUserImage) placements.push('user_image');
  if (hasToolResultImage) placements.push('tool_result_image');
  return Object.freeze({
    requires_image_input: true,
    placements: Object.freeze(placements),
  });
}
