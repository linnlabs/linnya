import { resolveLocalizedText, resolveRegisteredMessage, useLocalizationStore } from '@app/localization';
import { DOCUMENT_PREVIEW_MESSAGE_FALLBACKS } from '../definitions/documentPreviewMessageCatalog';
import type {
  DocumentPreviewMessageKey,
  DocumentPreviewMessageResolver,
} from '../definitions/documentPreviewMessages';

/** 非 Vue 代码按当前语言取文案；Vue 组件用 useLocalization，才能随语言切换更新。 */
export function resolveCurrentDocumentPreviewMessage(
  key: DocumentPreviewMessageKey,
  params?: Parameters<DocumentPreviewMessageResolver>[1],
): string {
  const localizationStore = useLocalizationStore();

  return resolveLocalizedText(
    params === undefined
      ? { key, fallback: DOCUMENT_PREVIEW_MESSAGE_FALLBACKS[key] }
      : { key, fallback: DOCUMENT_PREVIEW_MESSAGE_FALLBACKS[key], params },
    {
      locale: localizationStore.currentLocale,
      fallbackLocale: localizationStore.fallbackLocale,
      resolveMessage: resolveRegisteredMessage,
    },
  );
}
