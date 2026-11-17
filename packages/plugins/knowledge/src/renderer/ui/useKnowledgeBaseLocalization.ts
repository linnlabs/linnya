import { useLocalization } from '@app/localization';
import type { KnowledgeBaseLocalizationResult } from '../definitions/knowledgeBaseMessages';
import { createKnowledgeBaseMessageResolver } from '../functions/resolveKnowledgeBaseMessage';

export function useKnowledgeBaseLocalization(): KnowledgeBaseLocalizationResult {
  const { currentLocale, message } = useLocalization();

  return {
    currentLocale,
    knowledgeBaseMessage: createKnowledgeBaseMessageResolver(message),
  };
}
