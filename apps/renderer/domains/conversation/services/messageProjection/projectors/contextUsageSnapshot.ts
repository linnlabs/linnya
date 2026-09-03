import type { SSEContextUsageSnapshotEvent } from '@linnlabs/linnkit/contracts';

import {
  ConversationUserMessageMetadataSchema,
  projectConversationContextUsage,
} from '@app/schemas';
import type { MessageProjectionState, ProjectionResult } from '../state';
import { updateMessage } from '../helpers/messageAccess';

/** 将运行中的最新成功 Prompt 快照原子写入触发当前 execution 的用户消息。 */
export function projectContextUsageSnapshotEvent(
  state: MessageProjectionState,
  event: SSEContextUsageSnapshotEvent,
): ProjectionResult {
  if (!event.user_message_id) return { success: true, newState: state };

  updateMessage(state, event.user_message_id, (message) => {
    if (message.type !== 'user_input') return;
    message.metadata = ConversationUserMessageMetadataSchema.parse({
      ...(message.metadata ?? {}),
      context_usage: projectConversationContextUsage(event.context_usage),
    });
  });
  return { success: true, newState: state };
}
