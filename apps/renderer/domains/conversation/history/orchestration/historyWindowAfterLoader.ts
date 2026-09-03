import { loadAfter, type LoadAfterResult } from '../../message-window/orchestration/messageWindowLoader';
import { readDefaultMessageWindowLimit } from '../../message-window/orchestration/messageWindowApi';
import { useMessageWindowStore } from '../../message-window/store/messageWindowStore';
import { readConversationLiveMessages } from '../../message-window/orchestration/readConversationLiveMessages';

export type HistoryWindowAfterStatus = 'appended' | 'reloaded' | 'preparing' | 'skipped';

type MessageWindowStore = ReturnType<typeof useMessageWindowStore>;

export interface HistoryWindowAfterLoaderDeps {
  readonly store?: MessageWindowStore;
  readonly loadAfter?: (
    conversationId: string,
    cursor: number,
    options: { readonly limit?: number },
  ) => Promise<LoadAfterResult>;
}

export async function loadHistoryWindowAfter(
  conversationId: string,
  limit: number = readDefaultMessageWindowLimit(),
  deps: HistoryWindowAfterLoaderDeps = {},
): Promise<HistoryWindowAfterStatus> {
  const windowStore = deps.store ?? useMessageWindowStore();
  if (
    windowStore.conversationId !== conversationId
    || windowStore.status !== 'ready'
    || !windowStore.hasMoreAfter
    || windowStore.nextCursor === undefined
  ) {
    return 'skipped';
  }

  const loadAfterFn = deps.loadAfter ?? ((id, cursor, options) => loadAfter(
    id,
    cursor,
    options,
    { readLiveMessages: readConversationLiveMessages },
  ));
  const result = await loadAfterFn(conversationId, windowStore.nextCursor, { limit });
  if (result === 'superseded') return 'skipped';
  if (result === 'appended') return 'appended';
  if (result === 'replaced') return 'reloaded';
  return 'preparing';
}
