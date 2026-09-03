import { resolveLocalizedText, resolveRegisteredMessage, useLocalizationStore } from '@app/localization';
import { CONVERSATION_MESSAGE_FALLBACKS } from '../definitions/conversationMessageCatalog';
import type {
  ConversationMessageKey,
  ConversationMessageResolver,
} from '../definitions/conversationMessages';

export function resolveCurrentConversationMessage(
  key: ConversationMessageKey,
  params?: Parameters<ConversationMessageResolver>[1],
): string {
  const localizationStore = useLocalizationStore();

  return resolveLocalizedText(
    params === undefined
      ? { key, fallback: CONVERSATION_MESSAGE_FALLBACKS[key] }
      : { key, fallback: CONVERSATION_MESSAGE_FALLBACKS[key], params },
    {
      locale: localizationStore.currentLocale,
      fallbackLocale: localizationStore.fallbackLocale,
      resolveMessage: resolveRegisteredMessage,
    },
  );
}
