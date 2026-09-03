import {
  ConversationUserMessageMetadataSchema,
  type ConversationUserInputCommittedEvent,
} from '@app/schemas';
import type { BaseMessage } from '../types';

/** app-level commit ack 与 history projection 使用同一份 durable 用户展示事实。 */
export function mapCommittedUserInputToMessage(
  event: ConversationUserInputCommittedEvent,
): BaseMessage {
  return {
    id: event.id,
    role: 'user',
    type: 'user_input',
    content: event.raw_content,
    ...(event.attachments?.length ? { attachments: [...event.attachments] } : {}),
    timestamp: event.timestamp,
    metadata: ConversationUserMessageMetadataSchema.parse({
      ...(event.metadata ?? {}),
      turn_id: event.turn_id,
    }),
  };
}
