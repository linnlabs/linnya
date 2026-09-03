import { registerMessageCatalogs } from '@app/localization';
import { UPDATE_MESSAGE_CATALOG } from '../definitions/updateMessageCatalog';

let registered = false;

export function ensureUpdateLocalizationRegistered(): void {
  if (registered) return;

  registerMessageCatalogs(UPDATE_MESSAGE_CATALOG);
  registered = true;
}
