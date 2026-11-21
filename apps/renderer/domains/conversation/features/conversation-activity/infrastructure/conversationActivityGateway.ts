import { ConversationActivityListSchema, type ConversationActivityList } from '@app/schemas';
import { apiFetch, getApiBaseUrl } from '@shared/services/aiService/common';

/** App Server 运行状态写入后的失效信号；只用来触发重读，不带数据。 */
const CONVERSATION_ACTIVITY_CHANGED_CHANNEL = 'conversation-activity-changed';

export async function readConversationActivityList(): Promise<ConversationActivityList> {
  const baseUrl = await getApiBaseUrl();
  const response = await apiFetch(`${baseUrl}/api/v1/conversation/activity`);
  if (!response.ok) throw new Error(`HTTP ${response.status}: conversation activity`);
  return ConversationActivityListSchema.parse(await response.json());
}

export function subscribeConversationActivityChanged(listener: () => void): () => void {
  return window.electronAPI.on(CONVERSATION_ACTIVITY_CHANGED_CHANNEL, () => listener()) ?? (() => undefined);
}
