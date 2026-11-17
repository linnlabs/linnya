import type { MessageParams } from '@app/localization';
import { KNOWLEDGE_BASE_MESSAGE_FALLBACKS } from '../definitions/knowledgeBaseMessageCatalog';
import type {
  KnowledgeBaseMessageKey,
  KnowledgeBaseMessageResolver,
} from '../definitions/knowledgeBaseMessages';

export type KnowledgeBaseRawMessageResolver = (
  key: string,
  fallback: string,
  params?: MessageParams,
) => string;

export function resolveKnowledgeBaseMessage(
  key: KnowledgeBaseMessageKey,
  resolveMessage: KnowledgeBaseRawMessageResolver,
  params?: MessageParams,
): string {
  return resolveMessage(key, KNOWLEDGE_BASE_MESSAGE_FALLBACKS[key], params);
}

export function createKnowledgeBaseMessageResolver(
  resolveMessage: KnowledgeBaseRawMessageResolver,
): KnowledgeBaseMessageResolver {
  return (key, params) => resolveKnowledgeBaseMessage(key, resolveMessage, params);
}
