import { useLocalization } from '@app/localization';
import { createSettingsMessageResolver } from '../functions/resolveSettingsMessage';
import type { SettingsMessageResolver } from '../definitions/settingsMessages';

export interface UseSettingsLocalizationResult {
  readonly settingsMessage: SettingsMessageResolver;
}

export function useSettingsLocalization(): UseSettingsLocalizationResult {
  const { message } = useLocalization();

  return {
    settingsMessage: createSettingsMessageResolver(message),
  };
}
