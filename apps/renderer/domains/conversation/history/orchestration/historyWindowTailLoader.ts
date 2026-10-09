import { useSubrunTraceInvalidationStore } from '../../features/subrun-trace';
import { loadTail } from '../../message-window/orchestration/messageWindowLoader';
import { useMessageWindowStore } from '../../message-window/store/messageWindowStore';
import { readConversationLiveMessages } from '../../message-window/orchestration/readConversationLiveMessages';

export type HistoryWindowTailStatus = 'ready' | 'preparing';

export async function loadHistoryWindowTail(
  conversationId: string,
  limit: number,
): Promise<HistoryWindowTailStatus> {
  const windowStore = useMessageWindowStore();
  const previousRevision = windowStore.conversationId === conversationId ? windowStore.revision : null;
  await loadTail(conversationId, { limit }, { readLiveMessages: readConversationLiveMessages });
  // 回切时 run 可能已经终止，不会再有 detached tick；新窗口不能复用离开前的 ready trace。
  if (windowStore.conversationId === conversationId && windowStore.status === 'ready'
    && windowStore.revision !== previousRevision) {
    useSubrunTraceInvalidationStore().invalidateConversation(conversationId);
  }
  return windowStore.status === 'preparing' ? 'preparing' : 'ready';
}
