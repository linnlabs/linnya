import { resolveLocalizedText, resolveRegisteredMessage, useLocalizationStore } from '@app/localization';
import { LAYOUT_MESSAGE_FALLBACKS } from '../definitions/layoutMessageCatalog';
import type { LayoutMessageKey, LayoutMessageResolver } from '../definitions/layoutMessages';

export function resolveCurrentLayoutMessage(
  key: LayoutMessageKey,
  params?: Parameters<LayoutMessageResolver>[1],
): string {
  const localizationStore = useLocalizationStore();

  return resolveLocalizedText(
    params === undefined
      ? { key, fallback: LAYOUT_MESSAGE_FALLBACKS[key] }
      : { key, fallback: LAYOUT_MESSAGE_FALLBACKS[key], params },
    {
      locale: localizationStore.currentLocale,
      fallbackLocale: localizationStore.fallbackLocale,
      resolveMessage: resolveRegisteredMessage,
    },
  );
}
