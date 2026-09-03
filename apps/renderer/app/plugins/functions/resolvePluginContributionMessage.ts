import type { MessageParams } from '@app/localization';
import { PLUGIN_CONTRIBUTION_MESSAGE_FALLBACKS } from '../definitions/pluginContributionMessageCatalog';
import type {
  PluginContributionMessageKey,
  PluginContributionMessageResolver,
} from '../definitions/pluginContributionMessages';

export type PluginContributionRawMessageResolver = (
  key: string,
  fallback: string,
  params?: MessageParams,
) => string;

export function resolvePluginContributionMessage(
  key: PluginContributionMessageKey,
  resolveMessage: PluginContributionRawMessageResolver,
  params?: MessageParams,
): string {
  return resolveMessage(key, PLUGIN_CONTRIBUTION_MESSAGE_FALLBACKS[key], params);
}

export function createPluginContributionMessageResolver(
  resolveMessage: PluginContributionRawMessageResolver,
): PluginContributionMessageResolver {
  return (key, params) => resolvePluginContributionMessage(key, resolveMessage, params);
}
