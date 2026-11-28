import type { BaseMessage } from '../../../types';
import type { MessageProjectionState, ProjectionResult } from '../state';
import { appendMessage } from '../helpers/messageAccess';
import { mapRuntimeAttachmentsToConversation } from '../../../functions/runtimeAttachments';
import type { SSEUserInputEvent, UserInputEvent } from '@linnlabs/linnkit/contracts';
import { ConversationUserMessageMetadataSchema } from '@app/schemas';

/**
 * @description
 * 投影 user_input 事件（使用事件中的原始 message id）：历史回放，以及运行中实时送达的插话
 * （SSE 只回传插话，运行起点的输入由客户端发送时自己先显示）。
 */
export function projectUserInputEvent(
  state: MessageProjectionState,
  event: UserInputEvent | SSEUserInputEvent,
): ProjectionResult {
  const attachments = 'attachments' in event ? mapRuntimeAttachmentsToConversation(event.attachments) : undefined;
  const rawContent = 'raw_content' in event ? event.raw_content : undefined;
  const userMessage: BaseMessage = {
    id: event.id,
    role: 'user',
    type: 'user_input',
    // 后端 user_input.content 是给模型回放的完整上下文块；前端气泡只展示用户原文。
    content: rawContent ?? event.content,
    ...(attachments ? { attachments } : {}),
    timestamp: event.timestamp,
    metadata: ConversationUserMessageMetadataSchema.parse({
      user_quote: event.metadata?.user_quote,
      activity: event.metadata?.activity,
      extension: event.metadata?.extension,
      sender: event.metadata?.sender,
      delivery: event.delivery,
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
