import type { MessageParams } from '@app/localization';
import type { SettingsContribution } from '../definitions/settingsContribution';
import { SETTINGS_MESSAGE_FALLBACKS } from '../definitions/settingsMessageCatalog';
import type { SettingsMessageKey } from '../definitions/settingsMessages';

const SETTINGS_TAB_TITLE_KEYS: Readonly<Record<string, SettingsMessageKey>> = {
  appearance: 'settings.tabs.appearance',
  conversation: 'settings.tabs.conversation',
  'model-config': 'settings.tabs.modelConfig',
  'model-management': 'settings.tabs.modelManagement',
  model: 'settings.tabs.addModel',
  about: 'settings.tabs.about',
};

export function resolveSettingsContributionTitle(
  contribution: SettingsContribution,
  resolveTitle: SettingsContributionTitleResolver,
): string {
  const key = contribution.titleMessageKey ?? SETTINGS_TAB_TITLE_KEYS[contribution.id];
  const fallback = isSettingsMessageKey(key)
    ? SETTINGS_MESSAGE_FALLBACKS[key]
    : contribution.title;

  return key ? resolveTitle(key, fallback) : contribution.title;
}

export type SettingsContributionTitleResolver = (
  key: string,
  fallback: string,
  params?: MessageParams,
) => string;

function isSettingsMessageKey(key: string | undefined): key is SettingsMessageKey {
  return key !== undefined && Object.prototype.hasOwnProperty.call(SETTINGS_MESSAGE_FALLBACKS, key);
}
