import type { ConversationMessageKey, ConversationMessageResolver } from '../../../definitions/conversationMessages';
import { conversationMessageIdFromClientNoticeId, type ConversationClientNoticePayload } from '@app/schemas';
import type { BaseMessage } from '../../../types';
import type { ClientNoticeMessage } from '../definitions/clientNotice';
import type { LocalClientNotice } from '../definitions/clientNotice';

/** 显示内容来自有限错误分类，不回显客户端/供应商的原始响应。 */
export function clientNoticeText(notice: ConversationClientNoticePayload, resolve: ConversationMessageResolver): string {
  // 明确的业务原因已经包含操作指引，不再叠加“准备请求”等内部步骤名。
  if (notice.reason_code) return resolve(`conversation.clientNotice.reason.${notice.reason_code}`);
  return resolve('conversation.clientNotice.failure', {
    operation: resolve(`conversation.clientNotice.operation.${notice.operation}`),
    reason: resolve(clientNoticeReasonKey(notice)),
  });
}

function clientNoticeReasonKey(notice: ConversationClientNoticePayload): ConversationMessageKey {
  // 状态码只用于解释已知原因，保留在 metadata 中供诊断，不直接拼进提示。
  switch (notice.http_status) {
    case 400: return 'conversation.error.badRequest';
    case 401:
    case 403: return 'conversation.clientNotice.http.denied';
    case 404: return 'conversation.clientNotice.http.notFound';
    case 408:
    case 504: return 'conversation.clientNotice.http.timeout';
    case 429: return 'conversation.clientNotice.http.rateLimit';
  }
  if (notice.http_status !== undefined && notice.http_status >= 500) {
    return 'conversation.error.serviceUnavailable';
  }
  switch (notice.error_kind) {
    case 'connection': return 'conversation.clientNotice.kind.connection';
    case 'projection': return 'conversation.clientNotice.kind.projection';
    case 'validation': return 'conversation.clientNotice.kind.validation';
    default: return 'conversation.clientNotice.retry';
  }
}

export function localClientNoticeMessages(
  entries: readonly LocalClientNotice[],
  conversationId: string | null,
  draftKey: string,
  visible: readonly BaseMessage[],
): ClientNoticeMessage[] {
  const visibleIds = new Set(visible.map(message => message.id));
  return entries.filter(entry => entry.conversationId === conversationId
    && (conversationId !== null || entry.draftKey === draftKey)
    && !visibleIds.has(conversationMessageIdFromClientNoticeId(entry.command.notice_id)))
    .map(entry => ({
      id: conversationMessageIdFromClientNoticeId(entry.command.notice_id),
      role: 'system', type: 'client_notice', content: '', timestamp: entry.command.observed_at,
      metadata: { ...entry.command, origin: 'client', turn_id: null, run_id: null },
      localDelivery: entry.acceptedAt === null ? 'pending' : 'saved',
    }));
}
