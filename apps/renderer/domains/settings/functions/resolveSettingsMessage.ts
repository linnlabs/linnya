import { SETTINGS_MESSAGE_FALLBACKS } from '../definitions/settingsMessageCatalog';
import type { SettingsMessageKey, SettingsMessageResolver } from '../definitions/settingsMessages';
import type { MessageParams } from '@app/localization';

export type SettingsRawMessageResolver = (
  key: string,
  fallback: string,
  params?: MessageParams,
) => string;

export function resolveSettingsMessage(
  key: SettingsMessageKey,
  resolveMessage: SettingsRawMessageResolver,
  params?: MessageParams,
): string {
  const fallback = SETTINGS_MESSAGE_FALLBACKS[key];
  return resolveMessage(key, fallback, params);
}

export function createSettingsMessageResolver(
  resolveMessage: SettingsRawMessageResolver,
): SettingsMessageResolver {
  return (key, params) => resolveSettingsMessage(key, resolveMessage, params);
}
