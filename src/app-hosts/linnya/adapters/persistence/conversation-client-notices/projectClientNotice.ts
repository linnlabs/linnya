import { conversationMessageIdFromClientNoticeId } from '@app/schemas';
import type { NewUiMessageRow } from '../event-store/ui-projection/types';
import type { PersistedConversationClientNotice } from './sqliteClientNoticeAdmission';

export function projectClientNoticeToUiRow(
  fact: PersistedConversationClientNotice,
): Extract<NewUiMessageRow, { messageType: 'client_notice' }> {
  return {
    messageId: conversationMessageIdFromClientNoticeId(fact.payload.notice_id),
    conversationId: fact.conversationId,
    turnId: null,
    runId: null,
    timestamp: fact.payload.observed_at,
    role: 'system',
    messageType: 'client_notice',
    content: null,
    attachments: null,
    payload: fact.payload,
    mergeKey: null,
    presentation: null,
  };
}
