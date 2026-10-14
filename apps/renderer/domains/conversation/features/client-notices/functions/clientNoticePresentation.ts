import type { ConversationMessageResolver } from '../../../definitions/conversationMessages';
import { conversationMessageIdFromClientNoticeId, type ConversationClientNoticePayload } from '@app/schemas';
import type { BaseMessage } from '../../../types';
import type { ClientNoticeMessage } from '../definitions/clientNotice';
import type { LocalClientNotice } from '../definitions/clientNotice';

/** 显示内容来自有限错误分类，不回显客户端/供应商的原始响应。 */
export function clientNoticeText(notice: ConversationClientNoticePayload, resolve: ConversationMessageResolver): string {
  const operation = resolve(`conversation.clientNotice.operation.${notice.operation}`);
  const failure = notice.reason_code
    ? resolve(`conversation.clientNotice.reason.${notice.reason_code}`)
    : resolve(`conversation.clientNotice.kind.${notice.error_kind}`);
  return `${operation}: ${failure}${notice.http_status ? ` (HTTP ${notice.http_status})` : ''}`;
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
