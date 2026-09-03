import { registerMessageCatalogs } from '@app/localization';
import { SETTINGS_MESSAGE_CATALOG } from '../definitions/settingsMessageCatalog';

let registered = false;

export function ensureSettingsLocalizationRegistered(): void {
  if (registered) return;

  registerMessageCatalogs(SETTINGS_MESSAGE_CATALOG);
  registered = true;
}
