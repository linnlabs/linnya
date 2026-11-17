import { registerMessageCatalogs } from '@app/localization';
import { KNOWLEDGE_BASE_MESSAGE_CATALOG } from '../definitions/knowledgeBaseMessageCatalog';

let registered = false;

export function ensureKnowledgeBaseLocalizationRegistered(): void {
  if (registered) return;

  registerMessageCatalogs(KNOWLEDGE_BASE_MESSAGE_CATALOG);
  registered = true;
}
