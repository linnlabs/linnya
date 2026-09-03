import type { CSSProperties } from 'vue';
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

export function positionChatMenuDropdown(
  buttonEl: HTMLElement,
  dropdownEl: HTMLElement,
  viewport: { width: number; height: number },
): CSSProperties {
  const viewportGap = 8;
  const offset = 4;
  const buttonRect = buttonEl.getBoundingClientRect();
  const dropdownRect = dropdownEl.getBoundingClientRect();
  let top = buttonRect.bottom + offset;
  let left = buttonRect.left;

  if (left + dropdownRect.width > viewport.width - viewportGap) {
    left = buttonRect.right - dropdownRect.width;
  }
  if (left < viewportGap) left = viewportGap;

  if (top + dropdownRect.height > viewport.height - viewportGap) {
    top = buttonRect.top - dropdownRect.height - offset;
  }
  if (top < viewportGap) top = viewportGap;

  return {
    top: `${top}px`,
    left: `${left}px`,
  };
}

export function positionChatContextMenu(
  event: Pick<MouseEvent, 'clientX' | 'clientY'>,
  viewport: { width: number; height: number },
): CSSProperties {
  const viewportGap = 8;
  return {
    top: `${Math.min(event.clientY, viewport.height - viewportGap)}px`,
    left: `${Math.min(event.clientX, viewport.width - viewportGap)}px`,
  };
}
