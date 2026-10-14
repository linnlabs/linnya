import type { SSEEvent } from '@linnlabs/linnkit/contracts';
import {
  ConversationExecutionNoticeMetadataSchema,
  conversationMessageIdFromRetryIdentity,
  projectConversationErrorNotice,
} from '@app/schemas';
import type { ExecutionNoticeMessage } from '../../../features/error-surface/definitions/executionNotice';
import type { MessageProjectionState, ProjectionResult } from '../state';
import { appendMessage, getMessageById, replaceMessageById } from '../helpers/messageAccess';

type NoticeEvent = Extract<SSEEvent, { type: 'error' | 'llm_retry' }>;

export function projectExecutionNoticeEvent(
  state: MessageProjectionState,
  event: NoticeEvent
): ProjectionResult {
  if (!event.run_id) throw new Error('Execution notice requires routed run identity');
  const id = event.retry_id
    ? conversationMessageIdFromRetryIdentity(event.run_id, event.retry_id)
    : event.id;
  const previous = getMessageById(state, id);
  if (previous && previous.type !== 'execution_notice')
    throw new Error(`Execution notice identity conflicts with ${previous.type}`);
  const metadata = ConversationExecutionNoticeMetadataSchema.parse({
    ...(event.type === 'llm_retry'
      ? {
          ...(event.error_code ? { error_code: event.error_code } : {}),
          retry: {
            retry_id: event.retry_id,
            status: event.status,
            category: event.category,
            attempt: event.attempt,
            max_retries: event.max_retries,
            total_attempts: event.total_attempts,
            started_at: event.started_at,
            updated_at: event.timestamp,
            ...(event.next_retry_at === undefined ? {} : { next_retry_at: event.next_retry_at }),
          },
        }
      : { ...(previous?.metadata ?? {}), ...projectConversationErrorNotice(event) }),
    turn_id: event.turn_id,
    run_id: event.run_id,
    execution_id: event.execution_id,
    ...(event.retry_id ? { merge_key: id } : {}),
  });
  const message: ExecutionNoticeMessage = {
    id,
    role: 'system',
    type: 'execution_notice',
    content: '',
    timestamp: previous?.timestamp ?? event.timestamp,
    metadata,
  };
  if (previous) replaceMessageById(state, id, message);
  else appendMessage(state, message);
  return { success: true, newState: state, messageId: id };
}
