import { registerMessageCatalogs } from '@app/localization';
import { EDITOR_MESSAGE_CATALOG } from '../definitions/editorMessageCatalog';

let registered = false;

export function ensureEditorLocalizationRegistered(): void {
  if (registered) return;

  registerMessageCatalogs(EDITOR_MESSAGE_CATALOG);
  registered = true;
}
