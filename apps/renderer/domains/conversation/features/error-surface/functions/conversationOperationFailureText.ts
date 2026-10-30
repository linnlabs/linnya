import type { ConversationMessageKey, ConversationMessageResolver } from '../../../definitions/conversationMessages';
import type { ConversationOperationFailure } from '../definitions/conversationOperationFailure';

/** 显示内容来自有限错误分类，不回显客户端/供应商的原始响应。 */
export function conversationOperationFailureText(failure: ConversationOperationFailure, resolve: ConversationMessageResolver): string {
  // 明确的业务原因已经包含操作指引，不再叠加“准备请求”等内部步骤名。
  if (failure.reason_code) return resolve(`conversation.clientNotice.reason.${failure.reason_code}`);
  return resolve('conversation.clientNotice.failure', {
    operation: resolve(`conversation.clientNotice.operation.${failure.operation}`),
    reason: resolve(operationFailureReasonKey(failure)),
  });
}

function operationFailureReasonKey(failure: ConversationOperationFailure): ConversationMessageKey {
  // 状态码只用于解释已知原因，保留给诊断，不直接拼进提示。
  switch (failure.http_status) {
    case 400: return 'conversation.error.badRequest';
    case 401:
    case 403: return 'conversation.clientNotice.http.denied';
    case 404: return 'conversation.clientNotice.http.notFound';
    case 408:
    case 504: return 'conversation.clientNotice.http.timeout';
    case 429: return 'conversation.clientNotice.http.rateLimit';
  }
  if (failure.http_status !== undefined && failure.http_status >= 500) {
    return 'conversation.error.serviceUnavailable';
  }
  switch (failure.error_kind) {
    case 'connection': return 'conversation.clientNotice.kind.connection';
    case 'projection': return 'conversation.clientNotice.kind.projection';
    case 'validation': return 'conversation.clientNotice.kind.validation';
    default: return 'conversation.clientNotice.retry';
  }
}
