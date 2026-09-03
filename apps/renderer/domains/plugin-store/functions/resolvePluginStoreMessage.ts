import type { MessageParams } from '@app/localization';
import { PLUGIN_STORE_MESSAGE_FALLBACKS } from '../definitions/pluginStoreMessageCatalog';
import type { PluginStoreMessageKey, PluginStoreMessageResolver } from '../definitions/pluginStoreMessages';

export type PluginStoreRawMessageResolver = (
  key: string,
  fallback: string,
  params?: MessageParams,
) => string;

export function resolvePluginStoreMessage(
  key: PluginStoreMessageKey,
  resolveMessage: PluginStoreRawMessageResolver,
  params?: MessageParams,
): string {
  return resolveMessage(key, PLUGIN_STORE_MESSAGE_FALLBACKS[key], params);
}

export function createPluginStoreMessageResolver(
  resolveMessage: PluginStoreRawMessageResolver,
): PluginStoreMessageResolver {
  return (key, params) => resolvePluginStoreMessage(key, resolveMessage, params);
}
