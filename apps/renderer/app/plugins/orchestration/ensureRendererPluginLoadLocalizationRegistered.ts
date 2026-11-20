import { registerMessageCatalogs } from '@app/localization';
import { RENDERER_PLUGIN_LOAD_MESSAGE_CATALOG } from '../definitions/rendererPluginLoadMessageCatalog';

let registered = false;

export function ensureRendererPluginLoadLocalizationRegistered(): void {
  if (registered) return;

  registerMessageCatalogs(RENDERER_PLUGIN_LOAD_MESSAGE_CATALOG);
  registered = true;
}
