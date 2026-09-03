import { useLocalization } from '@app/localization';
import type { EditorLocalizationResult } from '../definitions/editorMessages';
import { createEditorMessageResolver } from '../functions/resolveEditorMessage';

export function useEditorLocalization(): EditorLocalizationResult {
  const { currentLocale, message } = useLocalization();

  return {
    currentLocale,
    editorMessage: createEditorMessageResolver(message),
  };
}
