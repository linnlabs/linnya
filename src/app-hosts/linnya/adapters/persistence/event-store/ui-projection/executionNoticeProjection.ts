import type { RuntimeEvent } from '@linnlabs/linnkit/contracts';
import {
  ConversationExecutionNoticePayloadSchema,
  conversationMessageIdFromRetryIdentity,
  projectConversationErrorNotice,
} from '@app/schemas';
import type { NewUiMessageRow, UiProjectionReadAccess, UiRowOp } from './types';

type NoticeEvent = Extract<RuntimeEvent, { type: 'error' | 'llm_retry' }>;

/** 错误与重试沿唯一 EventStore 事实链投影；不根据工具卡 loading 推断失败。 */
export function projectExecutionNotice(
  event: NoticeEvent,
  access: UiProjectionReadAccess
): UiRowOp[] {
  if (!event.run_id) throw new Error('Execution notice requires routed run identity');
  const retryId = event.retry_id;
  const messageId = retryId
    ? conversationMessageIdFromRetryIdentity(event.run_id, retryId)
    : event.id;
  const previous = access.getRowByMessageId(event.conversation_id, messageId);
  if (previous && previous.messageType !== 'execution_notice') {
    throw new Error(`Execution notice identity conflicts with ${previous.messageType}`);
  }
  const payload = ConversationExecutionNoticePayloadSchema.parse(
    event.type === 'llm_retry'
      ? {
          ...(event.error_code ? { error_code: event.error_code } : {}),
          ...(typeof event.metadata?.notice_execution_id === 'string'
            ? { execution_id: event.metadata.notice_execution_id }
            : {}),
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
      : {
          ...(previous?.payload ?? {}),
          ...projectConversationErrorNotice(event),
          ...(typeof event.metadata?.notice_execution_id === 'string'
            ? { execution_id: event.metadata.notice_execution_id }
            : {}),
        }
  );
  const row: NewUiMessageRow = {
    messageId,
    conversationId: event.conversation_id,
    turnId: event.turn_id,
    runId: event.run_id,
    timestamp: previous?.timestamp ?? event.timestamp,
    role: 'system',
    messageType: 'execution_notice',
    content: null,
    attachments: null,
    payload,
    mergeKey: retryId ? messageId : null,
    presentation: null,
  };
  return previous
    ? [{ op: 'replace', row: { ...row, sortSeq: previous.sortSeq } }]
    : [{ op: 'insert', row }];
}
