import { useLocalization } from '@app/localization';
import type { ConversationLocalizationResult } from '../definitions/conversationMessages';
import { createConversationMessageResolver } from '../functions/resolveConversationMessage';

export function useConversationLocalization(): ConversationLocalizationResult {
  const { currentLocale, message } = useLocalization();

  return {
    currentLocale,
    conversationMessage: createConversationMessageResolver(message),
  };
}
