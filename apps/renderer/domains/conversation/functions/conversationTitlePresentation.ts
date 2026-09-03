import type { Conversation } from '../types';

export interface ConversationTitleMessages {
  readonly noConversation: () => string;
  readonly untitledConversation: () => string;
}

export function resolveConversationTitle(
  conversation: Conversation | null,
  messages: ConversationTitleMessages,
): string {
  if (!conversation) return messages.noConversation();
  const title = conversation.title?.trim();
  return title || messages.untitledConversation();
}

export function isDefaultDraftConversation(
  conversation: { readonly titleOrigin?: Conversation['titleOrigin'] } | null | undefined,
): boolean {
  return conversation?.titleOrigin === 'default';
}

/**
 * Conversation pane 的标题层级由 Conversation 域投影，应用 Header 只负责摆放。
 * 父标题保持实时读取，不能复制进 Subrun scope；自动标题或手动改名可能在详情打开期间更新。
 */
export function projectConversationHeaderBreadcrumbSegments(input: {
  readonly conversation: Pick<Conversation, 'title' | 'titleOrigin'> | null | undefined;
  readonly subrunTitle: string | null;
}): readonly string[] {
  const conversationTitle = input.conversation?.title.trim() ?? '';
  if (!conversationTitle || isDefaultDraftConversation(input.conversation)) return [];

  const subrunTitle = input.subrunTitle?.trim() ?? '';
  return subrunTitle ? [conversationTitle, subrunTitle] : [conversationTitle];
}
