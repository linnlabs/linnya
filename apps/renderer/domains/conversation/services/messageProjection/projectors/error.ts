import type { MessageProjectionState, ProjectionResult } from '../state';
import { normalizeConversationError } from '../../errorNormalizer';
import { resolveCurrentConversationMessage } from '../../../functions/resolveCurrentConversationMessage';
import { isRecord } from '../../../utils/typeGuards';
import { projectExecutionNoticeEvent } from './executionNotice';
import type { SSEErrorEvent } from '@linnlabs/linnkit/contracts';

/**
 * @description
 * 投影 error 事件：
 * Runtime error 投影为持久时间线通知；现有 error result 仍供运行控制保留诊断，不能代替 run 状态。
 */
export function projectErrorEvent(state: MessageProjectionState, event: SSEErrorEvent): ProjectionResult {
  const normalized = normalizeConversationError(event, {
    resolveMessage: resolveCurrentConversationMessage,
  });
  const errorMessage = normalized.userMessage || resolveCurrentConversationMessage('conversation.error.generic');

  const errorCodeValue = isRecord(event) ? event['error_code'] : undefined;
  const errorCode = typeof errorCodeValue === 'string' ? errorCodeValue : undefined;
  const errorDetails = isRecord(event) ? event['details'] : undefined;

  // provider 原始 body 或历史 stack 只能留在诊断状态，不能被投影日志再次展开。
  console.error('[MessageProjection] 收到错误事件:', {
    errorMessage,
    errorCode,
    retryable: normalized.retryable,
  });

  return {
    ...projectExecutionNoticeEvent(state, event),
    error: errorMessage,
    errorDetails: {
      details: errorDetails,
      rawMessage: normalized.rawMessage,
      errorCode: normalized.errorCode,
      retryable: normalized.retryable,
      compatibleModelIds: normalized.compatibleModelIds,
    },
  };
}
