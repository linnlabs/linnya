import type { MessageProjectionState, ProjectionResult } from '../state';
import { normalizeConversationError } from '../../errorNormalizer';
import { resolveCurrentConversationMessage } from '../../../functions/resolveCurrentConversationMessage';
import { isRecord } from '../../../utils/typeGuards';
import type { SSEErrorEvent } from 'linnkit/contracts';

/**
 * @description
 * 投影 error 事件：
 * 摘要进度只由正式 summarization_error 事件更新；Runtime error 继续作为错误表面状态，
 * 禁止一个 error 事实同时承担 presentation lifecycle。
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
    success: true,
    newState: state,
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
