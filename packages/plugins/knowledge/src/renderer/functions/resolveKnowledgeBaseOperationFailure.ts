import { parseUserFacingMessage } from '@app/schemas';
import { KNOWLEDGE_BASE_MESSAGE_FALLBACKS } from '../definitions/knowledgeBaseMessageCatalog';
import type { KnowledgeBaseOperationFailure } from '../definitions/knowledgeBaseOperationFailure';
import type {
  KnowledgeBaseMessageKey,
  KnowledgeBaseMessageResolver,
} from '../definitions/knowledgeBaseMessages';

function isKnowledgeBaseMessageKey(key: string): key is KnowledgeBaseMessageKey {
  return Object.prototype.hasOwnProperty.call(KNOWLEDGE_BASE_MESSAGE_FALLBACKS, key);
}

export function resolveKnowledgeBaseOperationFailure(
  failure: KnowledgeBaseOperationFailure,
  knowledgeBaseMessage: KnowledgeBaseMessageResolver,
  fallbackKey: KnowledgeBaseMessageKey,
  fallbackParams?: Parameters<KnowledgeBaseMessageResolver>[1],
): string {
  const message = parseUserFacingMessage(failure.userMessage);
  if (message && isKnowledgeBaseMessageKey(message.key)) {
    return knowledgeBaseMessage(message.key, message.params);
  }

  return knowledgeBaseMessage(fallbackKey, fallbackParams);
}
