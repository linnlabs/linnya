import { useLocalization } from '@app/localization';
import {
  MANUAL_EDITING_MESSAGE_FALLBACKS,
  type ManualEditingMessageResolver,
} from '../definitions/manualEditingMessageCatalog';

export function useManualEditingLocalization(): {
  readonly manualEditingMessage: ManualEditingMessageResolver;
} {
  const { message } = useLocalization();
  return {
    manualEditingMessage: (key, params) => message(
      key,
      MANUAL_EDITING_MESSAGE_FALLBACKS[key],
      params,
    ),
  };
}
