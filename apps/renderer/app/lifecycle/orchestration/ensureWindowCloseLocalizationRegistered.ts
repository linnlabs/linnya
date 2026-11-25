import { registerMessageCatalogs } from '@app/localization';
import { WINDOW_CLOSE_MESSAGE_CATALOG } from '../definitions/windowCloseMessageCatalog';

let registered = false;

export function ensureWindowCloseLocalizationRegistered(): void {
  if (registered) return;

  registerMessageCatalogs(WINDOW_CLOSE_MESSAGE_CATALOG);
  registered = true;
}
