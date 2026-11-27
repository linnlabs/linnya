import type { ConversationListItem } from '../../history/services/historyApiService';
import type { ConversationMessageResolver } from '../../definitions/conversationMessages';

export type ChatMenuAction = 'pin' | 'rename' | 'delete' | 'retry_cleanup';

export interface ChatMenuOption {
  value: ChatMenuAction;
  text: string;
  variant?: 'danger';
}

export function buildChatMenuOptions(
  conversation: ConversationListItem | null,
  conversationMessage: ConversationMessageResolver,
): ChatMenuOption[] {
  if (conversation?.cleanup_pending === true) {
    return [{
      value: 'retry_cleanup',
      text: conversationMessage('conversation.sidebar.menu.retryCleanup'),
      variant: 'danger',
    }];
  }

  const pinText = conversation?.is_pinned === true
    ? conversationMessage('conversation.sidebar.menu.unpin')
    : conversationMessage('conversation.sidebar.menu.pin');

  return [
    { value: 'pin', text: pinText },
    { value: 'rename', text: conversationMessage('conversation.sidebar.menu.rename') },
    { value: 'delete', text: conversationMessage('conversation.sidebar.menu.delete'), variant: 'danger' },
  ];
}

export function buildContextMenuOptions(
  conversationMessage: ConversationMessageResolver,
): ChatMenuOption[] {
  return [{
    value: 'delete',
    text: conversationMessage('conversation.sidebar.menu.delete'),
    variant: 'danger',
  }];
}
