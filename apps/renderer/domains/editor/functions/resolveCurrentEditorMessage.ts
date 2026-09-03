import { resolveLocalizedText, resolveRegisteredMessage, useLocalizationStore } from '@app/localization';
import { EDITOR_MESSAGE_FALLBACKS } from '../definitions/editorMessageCatalog';
import type { EditorMessageKey, EditorMessageResolver } from '../definitions/editorMessages';

export function resolveCurrentEditorMessage(
  key: EditorMessageKey,
  params?: Parameters<EditorMessageResolver>[1],
): string {
  const localizationStore = useLocalizationStore();

  return resolveLocalizedText(
    params === undefined
      ? { key, fallback: EDITOR_MESSAGE_FALLBACKS[key] }
      : { key, fallback: EDITOR_MESSAGE_FALLBACKS[key], params },
    {
      locale: localizationStore.currentLocale,
      fallbackLocale: localizationStore.fallbackLocale,
      resolveMessage: resolveRegisteredMessage,
    },
  );
}
