import { resolveLocalizedText, resolveRegisteredMessage, useLocalizationStore } from '@app/localization';
import { TABLE_FILL_MESSAGE_FALLBACKS } from '../definitions/tableFillMessageCatalog';
import type {
  TableFillMessageKey,
  TableFillMessageResolver,
} from '../definitions/tableFillMessages';

export function resolveCurrentTableFillMessage(
  key: TableFillMessageKey,
  params?: Parameters<TableFillMessageResolver>[1],
): string {
  const localizationStore = useLocalizationStore();

  return resolveLocalizedText(
    params === undefined
      ? { key, fallback: TABLE_FILL_MESSAGE_FALLBACKS[key] }
      : { key, fallback: TABLE_FILL_MESSAGE_FALLBACKS[key], params },
    {
      locale: localizationStore.currentLocale,
      fallbackLocale: localizationStore.fallbackLocale,
      resolveMessage: resolveRegisteredMessage,
    },
  );
}
