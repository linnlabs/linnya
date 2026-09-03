import { registerMessageCatalogs } from '@app/localization';
import { SYSTEM_MESSAGE_CATALOG } from '../definitions/systemMessageCatalog';

let registered = false;

export function ensureSystemLocalizationRegistered(): void {
  if (registered) return;

  registerMessageCatalogs(SYSTEM_MESSAGE_CATALOG);
  registered = true;
}
