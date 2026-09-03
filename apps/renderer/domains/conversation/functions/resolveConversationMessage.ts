import type { MessageParams } from '@app/localization';
import { CONVERSATION_MESSAGE_FALLBACKS } from '../definitions/conversationMessageCatalog';
import type {
  ConversationMessageKey,
  ConversationMessageResolver,
} from '../definitions/conversationMessages';

export type ConversationRawMessageResolver = (
  key: string,
  fallback: string,
  params?: MessageParams,
) => string;

export function resolveConversationMessage(
  key: ConversationMessageKey,
  resolveMessage: ConversationRawMessageResolver,
  params?: MessageParams,
): string {
  return resolveMessage(key, CONVERSATION_MESSAGE_FALLBACKS[key], params);
}

export function createConversationMessageResolver(
  resolveMessage: ConversationRawMessageResolver,
): ConversationMessageResolver {
  return (key, params) => resolveConversationMessage(key, resolveMessage, params);
}
