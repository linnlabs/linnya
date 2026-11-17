import { resolveLocalizedText, resolveRegisteredMessage, useLocalizationStore } from '@app/localization';
import { KNOWLEDGE_BASE_MESSAGE_FALLBACKS } from '../definitions/knowledgeBaseMessageCatalog';
import type { KnowledgeBaseMessageKey, KnowledgeBaseMessageResolver } from '../definitions/knowledgeBaseMessages';

export function resolveCurrentKnowledgeBaseMessage(
  key: KnowledgeBaseMessageKey,
  params?: Parameters<KnowledgeBaseMessageResolver>[1],
): string {
  const localizationStore = useLocalizationStore();

  return resolveLocalizedText(
    params === undefined
      ? { key, fallback: KNOWLEDGE_BASE_MESSAGE_FALLBACKS[key] }
      : { key, fallback: KNOWLEDGE_BASE_MESSAGE_FALLBACKS[key], params },
    {
      locale: localizationStore.currentLocale,
      fallbackLocale: localizationStore.fallbackLocale,
      resolveMessage: resolveRegisteredMessage,
    },
  );
}
