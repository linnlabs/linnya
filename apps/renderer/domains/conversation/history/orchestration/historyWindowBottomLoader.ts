import { loadTail } from '../../message-window/orchestration/messageWindowLoader';
import { readDefaultMessageWindowLimit } from '../../message-window/orchestration/messageWindowApi';
import { useMessageWindowStore } from '../../message-window/store/messageWindowStore';
import { readConversationLiveMessages } from '../../message-window/orchestration/readConversationLiveMessages';

export type HistoryWindowBottomStatus = 'reloaded' | 'current' | 'preparing' | 'skipped';

type MessageWindowStore = ReturnType<typeof useMessageWindowStore>;

export interface HistoryWindowBottomLoaderDeps {
  readonly signal?: AbortSignal;
  readonly store?: MessageWindowStore;
  readonly loadTail?: (
    conversationId: string,
    options: { readonly limit?: number; readonly signal?: AbortSignal },
  ) => Promise<void>;
}

export async function ensureHistoryWindowTailForBottom(
  conversationId: string,
  limit: number = readDefaultMessageWindowLimit(),
  deps: HistoryWindowBottomLoaderDeps = {},
): Promise<HistoryWindowBottomStatus> {
  const windowStore = deps.store ?? useMessageWindowStore();
  if (windowStore.conversationId !== conversationId) {
    return 'skipped';
  }

  if (!windowStore.hasMoreAfter && windowStore.status === 'ready') {
    return 'current';
  }

  const loadTailFn = deps.loadTail ?? ((id, options) => loadTail(
    id,
    options,
    { readLiveMessages: readConversationLiveMessages },
  ));
  await loadTailFn(conversationId, { limit, signal: deps.signal });
  if (deps.signal?.aborted) return 'skipped';
  if (windowStore.conversationId !== conversationId) return 'skipped';
  if (windowStore.status === 'preparing') return 'preparing';
  return windowStore.status === 'ready' && !windowStore.hasMoreAfter ? 'reloaded' : 'skipped';
}
