import { registerMessageCatalogs } from '@app/localization';
import { LAYOUT_MESSAGE_CATALOG } from '../definitions/layoutMessageCatalog';

let registered = false;

export function ensureLayoutLocalizationRegistered(): void {
  if (registered) return;

  registerMessageCatalogs(LAYOUT_MESSAGE_CATALOG);
  registered = true;
}
