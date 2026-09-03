import { useLocalization } from '@app/localization';
import type { WorkspaceLocalizationResult } from '../definitions/workspaceMessages';
import { createWorkspaceMessageResolver } from '../functions/resolveWorkspaceMessage';

export function useWorkspaceLocalization(): WorkspaceLocalizationResult {
  const { currentLocale, message } = useLocalization();

  return {
    currentLocale,
    workspaceMessage: createWorkspaceMessageResolver(message),
  };
}
