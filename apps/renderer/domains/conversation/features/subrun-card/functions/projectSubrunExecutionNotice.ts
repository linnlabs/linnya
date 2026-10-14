import type { SSESubRunTraceEvent } from '@linnlabs/linnkit/contracts';
import {
  ConversationExecutionNoticeMetadataSchema,
  conversationMessageIdFromRetryIdentity,
  projectConversationErrorNotice,
} from '@app/schemas';
import type { BaseMessage } from '../../../types';
import type { ExecutionNoticeMessage } from '../../error-surface/definitions/executionNotice';

/** child 通知使用真实 subrun 身份，只属于详情画布，不写入主会话消息。 */
export function projectSubrunExecutionNotice(
  messages: BaseMessage[],
  event: SSESubRunTraceEvent
): void {
  const retry = event.retry;
  const failure = event.failure;
  if (event.kind === 'llm_retry' && !retry) throw new Error('Subrun retry payload missing');
  if (event.kind === 'error' && !failure) throw new Error('Subrun failure payload missing');
  const retryId = retry?.retry_id ?? failure?.retry_id;
  const id = retryId
    ? conversationMessageIdFromRetryIdentity(event.subrun_id, retryId)
    : event.source_event_id;
  const index = messages.findIndex(message => message.id === id);
  const previous = index < 0 ? undefined : messages[index];
  if (previous && previous.type !== 'execution_notice')
    throw new Error('Subrun notice identity conflict');
  const metadata = ConversationExecutionNoticeMetadataSchema.parse({
    ...(retry
      ? {
          ...(retry.error_code ? { error_code: retry.error_code } : {}),
          retry: {
            retry_id: retry.retry_id,
            status: retry.status,
            category: retry.category,
            attempt: retry.attempt,
            max_retries: retry.max_retries,
            total_attempts: retry.total_attempts,
            started_at: retry.started_at,
            updated_at: event.timestamp,
            ...(retry.next_retry_at === undefined ? {} : { next_retry_at: retry.next_retry_at }),
          },
        }
      : { ...previous?.metadata, ...projectConversationErrorNotice(failure ?? {}) }),
    turn_id: event.turn_id,
    run_id: event.subrun_id,
    execution_id: event.execution_id ?? event.metadata?.notice_execution_id,
    ...(retryId ? { merge_key: id } : {}),
  });
  const message: ExecutionNoticeMessage = {
    id,
    role: 'system',
    type: 'execution_notice',
    content: '',
    metadata,
    timestamp: previous?.timestamp ?? event.timestamp,
  };
  if (index < 0) messages.push(message);
  else messages[index] = message;
}
