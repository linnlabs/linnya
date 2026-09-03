import { useLocalization } from '@app/localization';
import type { PluginContributionMessageResolver } from '../definitions/pluginContributionMessages';
import { createPluginContributionMessageResolver } from '../functions/resolvePluginContributionMessage';

export interface PluginContributionLocalizationResult {
  readonly pluginContributionMessage: PluginContributionMessageResolver;
}

export function usePluginContributionLocalization(): PluginContributionLocalizationResult {
  const { message } = useLocalization();

  return {
    pluginContributionMessage: createPluginContributionMessageResolver(message),
  };
}
