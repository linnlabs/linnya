import type { ConversationExecutionNoticePayload } from '@app/schemas';
import type { ConversationMessageResolver } from '../../../definitions/conversationMessages';
import type { ExecutionActivity } from '../../../shared/execution-presentation';
import { normalizeConversationError } from '../../../services/errorNormalizer';

/** 展示只消费已接纳事实；UI 计时不改变重试次数、状态或下一次请求时间。 */
export function projectExecutionNoticePresentation(
  notice: ConversationExecutionNoticePayload,
  now: number,
  resolveMessage: ConversationMessageResolver,
  executionActive = false
): {
  text: string;
  active: boolean;
  failed: boolean;
  elapsedSeconds?: number;
  remainingSeconds?: number;
} {
  const retry = notice.retry;
  const normalized = normalizeConversationError(
    {
      error_code: notice.error_code,
      details: {
        metadata: {
          compatible_model_ids: notice.compatible_model_ids,
          required_placements: notice.required_placements,
        },
      },
    },
    { resolveMessage }
  );
  if (!retry) return { text: normalized.userMessage, active: false, failed: true };
  const unsettled = retry.status === 'waiting' || retry.status === 'retrying';
  const active = unsettled && executionActive;
  const reason =
    retry.category === 'transport'
      ? resolveMessage('conversation.retry.network')
      : retry.category === 'output'
        ? resolveMessage('conversation.retry.output')
        : normalized.userMessage;
  const status =
    retry.status === 'succeeded'
      ? resolveMessage('conversation.retry.recovered')
      : retry.status === 'cancelled'
        ? resolveMessage('conversation.retry.cancelled')
        : unsettled && !active
          ? `${reason} · ${resolveMessage('conversation.retry.interrupted')}`
          : reason;
  return {
    text: `${status} (${retry.attempt}/${retry.max_retries})`,
    active,
    failed: retry.status === 'exhausted' || retry.status === 'failed',
    ...(!unsettled || active
      ? {
          elapsedSeconds: Math.max(
            0,
            Math.floor(((active ? now : retry.updated_at) - retry.started_at) / 1000)
          ),
        }
      : {}),
    ...(active && retry.status === 'waiting' && retry.next_retry_at !== undefined
      ? { remainingSeconds: Math.max(0, Math.ceil((retry.next_retry_at - now) / 1000)) }
      : {}),
  };
}

/** 冷重载、恢复与 child 继承只核对正式执行归属，不将未结算事实自动改成终态。 */
export function isExecutionNoticeExecuting(
  notice: ConversationExecutionNoticePayload,
  activity: ExecutionActivity
): boolean {
  return (
    activity.isExecuting &&
    notice.execution_id !== undefined &&
    activity.executionId === notice.execution_id
  );
}
