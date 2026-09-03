import type { SSERunExecutionMetricsEvent } from '@linnlabs/linnkit/contracts';

import type { MessageProjectionState, ProjectionResult } from '../state';
import { updateMessage } from '../helpers/messageAccess';
import {
  ConversationUserMessageMetadataSchema,
  projectConversationContextUsage,
} from '@app/schemas';

/** 将服务端执行统计归档到触发本轮执行的用户消息。 */
export function projectRunExecutionMetricsEvent(
  state: MessageProjectionState,
  event: SSERunExecutionMetricsEvent,
): ProjectionResult {
  if (!event.user_message_id) return { success: true, newState: state };

  updateMessage(state, event.user_message_id, (message) => {
    if (message.type !== 'user_input') return;
    message.metadata = ConversationUserMessageMetadataSchema.parse({
      ...(message.metadata ?? {}),
      agent_work: {
        duration_ms: event.duration_ms,
        ended_at: event.timestamp,
        outcome: event.outcome,
      },
      ...(event.context_usage
        ? { context_usage: projectConversationContextUsage(event.context_usage) }
        : {}),
    });
  });
  return { success: true, newState: state };
}
