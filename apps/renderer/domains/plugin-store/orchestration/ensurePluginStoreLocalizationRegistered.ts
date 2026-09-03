import { registerMessageCatalogs } from '@app/localization';
import { PLUGIN_STORE_MESSAGE_CATALOG } from '../definitions/pluginStoreMessageCatalog';

let registered = false;

export function ensurePluginStoreLocalizationRegistered(): void {
  if (registered) return;

  registerMessageCatalogs(PLUGIN_STORE_MESSAGE_CATALOG);
  registered = true;
}
