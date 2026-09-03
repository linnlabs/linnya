import { registerMessageCatalogs } from '@app/localization';
import { WORKSPACE_MESSAGE_CATALOG } from '../definitions/workspaceMessageCatalog';

let registered = false;

export function ensureWorkspaceLocalizationRegistered(): void {
  if (registered) return;

  registerMessageCatalogs(WORKSPACE_MESSAGE_CATALOG);
  registered = true;
}
