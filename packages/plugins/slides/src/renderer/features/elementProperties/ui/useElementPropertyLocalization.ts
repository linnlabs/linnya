import { useLocalization } from '@app/localization';
import {
  ELEMENT_PROPERTY_MESSAGE_FALLBACKS,
  type ElementPropertyMessageResolver,
} from '../definitions/elementPropertyMessageCatalog';

export function useElementPropertyLocalization(): {
  elementPropertyMessage: ElementPropertyMessageResolver;
} {
  const { message } = useLocalization();
  return {
    elementPropertyMessage: (key, params) => message(
      key,
      ELEMENT_PROPERTY_MESSAGE_FALLBACKS[key],
      params,
    ),
  };
}
