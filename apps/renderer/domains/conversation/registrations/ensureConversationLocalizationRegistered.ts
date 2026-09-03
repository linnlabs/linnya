import { registerMessageCatalogs } from '@app/localization';
import { CONVERSATION_MESSAGE_CATALOG } from '../definitions/conversationMessageCatalog';

let registered = false;

export function ensureConversationLocalizationRegistered(): void {
  if (registered) return;

  registerMessageCatalogs(CONVERSATION_MESSAGE_CATALOG);
  registered = true;
}
