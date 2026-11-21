import { registerMessageCatalogs } from '@app/localization';
import { BACKEND_HEALTH_MESSAGE_CATALOG } from '../definitions/backendHealthMessageCatalog';

let registered = false;

export function ensureBackendHealthLocalizationRegistered(): void {
  if (registered) return;
  registerMessageCatalogs(BACKEND_HEALTH_MESSAGE_CATALOG);
  registered = true;
}
