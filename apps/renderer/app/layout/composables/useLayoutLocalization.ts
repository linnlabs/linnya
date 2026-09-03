import { useLocalization } from '@app/localization';
import type { LayoutMessageResolver } from '../definitions/layoutMessages';
import { createLayoutMessageResolver } from '../functions/resolveLayoutMessage';

export interface UseLayoutLocalizationResult {
  readonly layoutMessage: LayoutMessageResolver;
}

export function useLayoutLocalization(): UseLayoutLocalizationResult {
  const { message } = useLocalization();

  return {
    layoutMessage: createLayoutMessageResolver(message),
  };
}
