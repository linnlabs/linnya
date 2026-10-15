import { useLocalization } from '@app/localization';
import {
  DECK_NAVIGATOR_MESSAGE_FALLBACKS,
  type DeckNavigatorMessageResolver,
} from '../definitions/deckNavigatorMessageCatalog';

export function useDeckNavigatorLocalization(): { readonly deckNavigatorMessage: DeckNavigatorMessageResolver } {
  const { message } = useLocalization();
  return {
    deckNavigatorMessage: (key, params) => message(key, DECK_NAVIGATOR_MESSAGE_FALLBACKS[key], params),
  };
}
