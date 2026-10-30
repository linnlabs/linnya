import { conversationMessageIdFromClientNoticeId } from '@app/schemas';
import type { BaseMessage } from '../../../types';
import type { ClientNoticeMessage } from '../definitions/clientNotice';
import type { LocalClientNotice } from '../definitions/clientNotice';

export function localClientNoticeMessages(
  entries: readonly LocalClientNotice[],
  conversationId: string | null,
  draftKey: string,
  visible: readonly BaseMessage[],
): ClientNoticeMessage[] {
  const visibleIds = new Set(visible.map(message => message.id));
  return entries.filter(entry => entry.command.operation !== 'load'
    && entry.conversationId === conversationId
    && (conversationId !== null || entry.draftKey === draftKey)
    && !visibleIds.has(conversationMessageIdFromClientNoticeId(entry.command.notice_id)))
    .map(entry => ({
      id: conversationMessageIdFromClientNoticeId(entry.command.notice_id),
      role: 'system', type: 'client_notice', content: '', timestamp: entry.command.observed_at,
      metadata: { ...entry.command, origin: 'client', turn_id: null, run_id: null },
      localDelivery: entry.acceptedAt === null ? 'pending' : 'saved',
    }));
}
