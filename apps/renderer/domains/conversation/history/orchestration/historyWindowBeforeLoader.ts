import { loadBefore, type LoadBeforeResult } from '../../message-window/orchestration/messageWindowLoader';
import { readDefaultMessageWindowLimit } from '../../message-window/orchestration/messageWindowApi';
import { useMessageWindowStore } from '../../message-window/store/messageWindowStore';
import { readConversationLiveMessages } from '../../message-window/orchestration/readConversationLiveMessages';

export type HistoryWindowBeforeStatus = 'prepended' | 'reloaded' | 'preparing' | 'skipped';

type MessageWindowStore = ReturnType<typeof useMessageWindowStore>;

export interface HistoryWindowBeforeLoaderDeps {
  readonly store?: MessageWindowStore;
  readonly loadBefore?: (
    conversationId: string,
    cursor: number,
    options: { readonly limit?: number },
  ) => Promise<LoadBeforeResult>;
}

export async function loadHistoryWindowBefore(
  conversationId: string,
  limit: number = readDefaultMessageWindowLimit(),
  deps: HistoryWindowBeforeLoaderDeps = {},
): Promise<HistoryWindowBeforeStatus> {
  const windowStore = deps.store ?? useMessageWindowStore();
  if (
    windowStore.conversationId !== conversationId
    || windowStore.status !== 'ready'
    || !windowStore.hasMoreBefore
    || windowStore.prevCursor === undefined
  ) {
    return 'skipped';
  }

  const loadBeforeFn = deps.loadBefore ?? ((id, cursor, options) => loadBefore(
    id,
    cursor,
    options,
    { readLiveMessages: readConversationLiveMessages },
  ));
  const result = await loadBeforeFn(conversationId, windowStore.prevCursor, { limit });
  if (result === 'superseded') return 'skipped';
  if (result === 'prepended') return 'prepended';
  if (result === 'replaced') return 'reloaded';
  return 'preparing';
}
