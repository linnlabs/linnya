import type { BaseMessage } from '../../../types';
import type { MessageProjectionState, ProjectionResult } from '../state';
import { appendMessage } from '../helpers/messageAccess';
import { mapRuntimeAttachmentsToConversation } from '../../../functions/runtimeAttachments';
import type { UserInputEvent } from '@linnlabs/linnkit/contracts';
import { ConversationUserMessageMetadataSchema } from '@app/schemas';

/**
 * @description
 * 历史回放：投影 user_input 事件（使用事件中的原始 message id）。
 */
export function projectUserInputEvent(state: MessageProjectionState, event: UserInputEvent): ProjectionResult {
  const attachments = mapRuntimeAttachmentsToConversation(event.attachments);
  const userMessage: BaseMessage = {
    id: event.id,
    role: 'user',
    type: 'user_input',
    // 后端 user_input.content 是给模型回放的完整上下文块；前端气泡只展示用户原文。
    content: event.raw_content ?? event.content,
    ...(attachments ? { attachments } : {}),
    timestamp: event.timestamp,
    metadata: ConversationUserMessageMetadataSchema.parse({
      user_quote: event.metadata?.user_quote,
      activity: event.metadata?.activity,
      extension: event.metadata?.extension,
      ui: event.metadata?.ui,
      turn_id: event.turn_id,
      ...(event.run_id ? { run_id: event.run_id } : {}),
    }),
  };

  appendMessage(state, userMessage);

  return {
    success: true,
    messageId: userMessage.id,
    newState: state,
  };
}
