import type { NavigationScope } from '@/app/navigation';
import type { ConversationListItem } from '../services/historyApiService';
import type { ScopeCacheSnapshot } from '../definitions/historyList';
import { sortSidebarConversations } from '../../functions/sidebarConversationListSort';
export function cloneScope(scope: NavigationScope): NavigationScope {
  return scope.kind === 'project'
    ? { kind: 'project', projectId: scope.projectId }
    : { kind: 'linnya-assistant' };
}

export function createEmptySnapshot(): ScopeCacheSnapshot {
  return {
    conversations: [],
    nextCursor: undefined,
    hasMore: true,
    isComplete: false,
    isLoading: false,
    error: null,
    lastRefreshTime: 0,
    searchQuery: '',
  };
}

export function getScopeForConversation(conversation: ConversationListItem): NavigationScope {
  return typeof conversation.project_id === 'string' && conversation.project_id.trim().length > 0
    ? { kind: 'project', projectId: conversation.project_id }
    : { kind: 'linnya-assistant' };
}

export function isConversationInScope(
  conversation: ConversationListItem,
  scope: NavigationScope
): boolean {
  return scope.kind === 'project'
    ? conversation.project_id === scope.projectId
    : !conversation.project_id;
}

export function cloneConversations(conversations: ConversationListItem[]): ConversationListItem[] {
  return conversations.map(conversation => ({ ...conversation }));
}
export function projectUpdatedHistoryList(
  items: ConversationListItem[],
  id: string,
  updates: Partial<ConversationListItem>
): ConversationListItem[] {
  return sortSidebarConversations(
    items.map(item => (item.conversation_id === id ? { ...item, ...updates } : item))
  );
}
export function projectUpsertedHistoryList(
  items: ConversationListItem[],
  conversation: ConversationListItem
): ConversationListItem[] {
  const existing = items.some(item => item.conversation_id === conversation.conversation_id);
  return sortSidebarConversations(
    existing
      ? items.map(item =>
          item.conversation_id === conversation.conversation_id
            ? { ...item, ...conversation }
            : item
        )
      : [conversation, ...items]
  );
}
export function projectLoadedHistoryList(
  items: ConversationListItem[],
  forgottenIds: readonly string[]
): ConversationListItem[] {
  return sortSidebarConversations(
    cloneConversations(items.filter(item => !forgottenIds.includes(item.conversation_id)))
  );
}
export function projectTouchedHistoryList(
  items: ConversationListItem[],
  id: string,
  timestamp: number
) {
  let didUpdate = false;
  const conversations = sortSidebarConversations(
    items.map(item => {
      if (item.conversation_id !== id) return item;
      const nextLastEventAt = Math.max(item.last_event_at, Math.floor(timestamp));
      if (nextLastEventAt === item.last_event_at) return item;
      didUpdate = true;
      return { ...item, last_event_at: nextLastEventAt };
    })
  );
  return { conversations, didUpdate };
}
