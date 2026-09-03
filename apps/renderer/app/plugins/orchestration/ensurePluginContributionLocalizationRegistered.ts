import { registerMessageCatalogs } from '@app/localization';
import { PLUGIN_CONTRIBUTION_MESSAGE_CATALOG } from '../definitions/pluginContributionMessageCatalog';

let registered = false;

export function ensurePluginContributionLocalizationRegistered(): void {
  if (registered) return;

  registerMessageCatalogs(PLUGIN_CONTRIBUTION_MESSAGE_CATALOG);
  registered = true;
}
