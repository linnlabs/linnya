import type { ConversationListItem } from '../../history/services/historyApiService';
import type { ConversationMessageResolver } from '../../definitions/conversationMessages';

export const collapsedConversationCount = 5;

export function filterSidebarConversations(
  conversations: ConversationListItem[],
  normalizedSearchQuery: string,
  conversationMessage: ConversationMessageResolver,
): ConversationListItem[] {
  if (!normalizedSearchQuery) return conversations;

  return conversations.filter(conversation => (
    (conversation.title || conversationMessage('conversation.sidebar.untitled'))
      .toLowerCase()
      .includes(normalizedSearchQuery)
  ));
}

export function getVisibleSidebarConversations(
  conversations: ConversationListItem[],
  options: { bypassCollapse: boolean; expanded: boolean },
): ConversationListItem[] {
  if (options.bypassCollapse || options.expanded) return conversations;
  return conversations.slice(0, collapsedConversationCount);
}

export function shouldShowSidebarExpandControl(
  conversationCount: number,
  options: { bypassCollapse: boolean; expanded: boolean },
): boolean {
  return !options.bypassCollapse
    && !options.expanded
    && conversationCount > collapsedConversationCount;
}

export function shouldShowSidebarCollapseControl(
  conversationCount: number,
  options: { bypassCollapse: boolean; expanded: boolean },
): boolean {
  return !options.bypassCollapse
    && options.expanded
    && conversationCount > collapsedConversationCount;
}
