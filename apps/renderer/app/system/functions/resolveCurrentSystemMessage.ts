import { resolveLocalizedText, resolveRegisteredMessage, useLocalizationStore } from '@app/localization';
import { SYSTEM_MESSAGE_FALLBACKS } from '../definitions/systemMessageCatalog';
import type {
  SystemMessageKey,
  SystemMessageResolver,
} from '../definitions/systemMessages';

export function isSystemMessageKey(key: string): key is SystemMessageKey {
  return Object.prototype.hasOwnProperty.call(SYSTEM_MESSAGE_FALLBACKS, key);
}

export function resolveCurrentSystemMessage(
  key: SystemMessageKey,
  params?: Parameters<SystemMessageResolver>[1],
): string {
  const localizationStore = useLocalizationStore();

  return resolveLocalizedText(
    params === undefined
      ? { key, fallback: SYSTEM_MESSAGE_FALLBACKS[key] }
      : { key, fallback: SYSTEM_MESSAGE_FALLBACKS[key], params },
    {
      locale: localizationStore.currentLocale,
      fallbackLocale: localizationStore.fallbackLocale,
      resolveMessage: resolveRegisteredMessage,
    },
  );
}
