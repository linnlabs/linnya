import { useLocalization } from '@app/localization';
import type { PluginStoreMessageResolver } from '../definitions/pluginStoreMessages';
import { createPluginStoreMessageResolver } from '../functions/resolvePluginStoreMessage';

export interface UsePluginStoreLocalizationResult {
  readonly pluginStoreMessage: PluginStoreMessageResolver;
}

export function usePluginStoreLocalization(): UsePluginStoreLocalizationResult {
  const { message } = useLocalization();

  return {
    pluginStoreMessage: createPluginStoreMessageResolver(message),
  };
}
