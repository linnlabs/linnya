import {
  resolveLocalizedText,
  resolveRegisteredMessage,
  useLocalizationStore,
} from '@app/localization';
import { PLUGIN_CONTRIBUTION_MESSAGE_FALLBACKS } from '../definitions/pluginContributionMessageCatalog';
import type {
  PluginContributionMessageKey,
  PluginContributionMessageResolver,
} from '../definitions/pluginContributionMessages';

export function resolveCurrentPluginContributionMessage(
  key: PluginContributionMessageKey,
  params?: Parameters<PluginContributionMessageResolver>[1],
): string {
  const localizationStore = useLocalizationStore();

  return resolveLocalizedText(
    params === undefined
      ? { key, fallback: PLUGIN_CONTRIBUTION_MESSAGE_FALLBACKS[key] }
      : { key, fallback: PLUGIN_CONTRIBUTION_MESSAGE_FALLBACKS[key], params },
    {
      locale: localizationStore.currentLocale,
      fallbackLocale: localizationStore.fallbackLocale,
      resolveMessage: resolveRegisteredMessage,
    },
  );
}
