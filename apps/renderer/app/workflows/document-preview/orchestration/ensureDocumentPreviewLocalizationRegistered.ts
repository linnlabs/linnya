import { registerMessageCatalogs } from '@app/localization';
import { DOCUMENT_PREVIEW_MESSAGE_CATALOG } from '../definitions/documentPreviewMessageCatalog';

let registered = false;

export function ensureDocumentPreviewLocalizationRegistered(): void {
  if (registered) return;

  registerMessageCatalogs(DOCUMENT_PREVIEW_MESSAGE_CATALOG);
  registered = true;
}
