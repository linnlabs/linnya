import { useLocalization } from '@app/localization';
import type { UpdateMessageResolver } from '../definitions/updateMessages';
import { createUpdateMessageResolver } from '../functions/resolveUpdateMessage';

export interface UseUpdateLocalizationResult {
  readonly updateMessage: UpdateMessageResolver;
}

export function useUpdateLocalization(): UseUpdateLocalizationResult {
  const { message } = useLocalization();

  return {
    updateMessage: createUpdateMessageResolver(message),
  };
}
