import { useLocalization } from '@app/localization';
import {
  SLIDES_TOOL_CARD_MESSAGE_FALLBACKS,
  type SlidesToolCardMessageResolver,
} from '../definitions/slidesToolCardMessageCatalog';

export interface SlidesToolCardLocalizationResult {
  readonly currentLocale: ReturnType<typeof useLocalization>['currentLocale'];
  readonly slidesToolCardMessage: SlidesToolCardMessageResolver;
}

export function useSlidesToolCardLocalization(): SlidesToolCardLocalizationResult {
  const { currentLocale, message } = useLocalization();

  return {
    currentLocale,
    slidesToolCardMessage: (key, params) => message(
      key,
      SLIDES_TOOL_CARD_MESSAGE_FALLBACKS[key],
      params,
    ),
  };
}
