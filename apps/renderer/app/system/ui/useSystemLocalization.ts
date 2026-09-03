import { useLocalization } from '@app/localization';
import type { SystemLocalizationResult } from '../definitions/systemMessages';
import { createSystemMessageResolver } from '../functions/resolveSystemMessage';

export function useSystemLocalization(): SystemLocalizationResult {
  const { currentLocale, message } = useLocalization();

  return {
    currentLocale,
    systemMessage: createSystemMessageResolver(message),
  };
}
