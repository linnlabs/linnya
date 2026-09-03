import { registerMessageCatalogs } from '@app/localization';
import { TABLE_FILL_MESSAGE_CATALOG } from '../definitions/tableFillMessageCatalog';

let registered = false;

export function ensureTableFillLocalizationRegistered(): void {
  if (registered) return;

  registerMessageCatalogs(TABLE_FILL_MESSAGE_CATALOG);
  registered = true;
}
