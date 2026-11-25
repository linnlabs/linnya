import { useLocalization } from '@app/localization';
import { WINDOW_CLOSE_MESSAGE_FALLBACKS } from '../definitions/windowCloseMessageCatalog';
import type { WindowCloseMessageResolver } from '../definitions/windowCloseMessages';

export function useWindowCloseLocalization(): { readonly windowCloseMessage: WindowCloseMessageResolver } {
  const { message } = useLocalization();
  return {
    windowCloseMessage: (key, params) => message(key, WINDOW_CLOSE_MESSAGE_FALLBACKS[key], params),
  };
}
