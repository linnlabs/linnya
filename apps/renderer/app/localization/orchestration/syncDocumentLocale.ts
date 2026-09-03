import type { LinnyaLocale } from '../definitions/locale';
import { mapLocaleForHtml } from '../functions/mapLocaleForHtml';

export function syncDocumentLocale(documentRef: Document, locale: LinnyaLocale): void {
  documentRef.documentElement.lang = mapLocaleForHtml(locale);
}
