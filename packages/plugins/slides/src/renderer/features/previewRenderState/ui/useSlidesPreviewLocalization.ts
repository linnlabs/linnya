import { useLocalization } from '@app/localization';
import {
  SLIDES_PREVIEW_MESSAGE_FALLBACKS,
  type SlidesPreviewMessageResolver,
} from '../definitions/slidesPreviewMessageCatalog';

export interface SlidesPreviewLocalizationResult {
  readonly slidesPreviewMessage: SlidesPreviewMessageResolver;
}

export function useSlidesPreviewLocalization(): SlidesPreviewLocalizationResult {
  const { message } = useLocalization();

  return {
    slidesPreviewMessage: (key, params) => message(
      key,
      SLIDES_PREVIEW_MESSAGE_FALLBACKS[key],
      params,
    ),
  };
}
