import { ConversationClientNoticeReceiptSchema, type ConversationClientNoticeCommand } from '@app/schemas';
import { apiFetch, getApiBaseUrl } from '@/shared/services/aiService/common';

export async function sendClientNotice(conversationId: string, command: ConversationClientNoticeCommand) {
  const baseUrl = await getApiBaseUrl();
  const response = await apiFetch(`${baseUrl}/api/v1/conversation/${encodeURIComponent(conversationId)}/client-notices/${command.notice_id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error(`Client notice sync failed: HTTP ${response.status}`);
  return ConversationClientNoticeReceiptSchema.parse(await response.json());
}
