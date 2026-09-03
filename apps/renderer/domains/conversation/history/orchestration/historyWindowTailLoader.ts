import { loadTail } from '../../message-window/orchestration/messageWindowLoader';
import { useMessageWindowStore } from '../../message-window/store/messageWindowStore';
import { readConversationLiveMessages } from '../../message-window/orchestration/readConversationLiveMessages';

export type HistoryWindowTailStatus = 'ready' | 'preparing';

export async function loadHistoryWindowTail(
  conversationId: string,
  limit: number,
): Promise<HistoryWindowTailStatus> {
  await loadTail(conversationId, { limit }, { readLiveMessages: readConversationLiveMessages });
  const windowStore = useMessageWindowStore();
  return windowStore.status === 'preparing' ? 'preparing' : 'ready';
}
