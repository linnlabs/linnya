import { resolveLocalizedText, resolveRegisteredMessage, useLocalizationStore } from '@app/localization';
import { WORKSPACE_MESSAGE_FALLBACKS } from '../definitions/workspaceMessageCatalog';
import type { WorkspaceMessageKey, WorkspaceMessageResolver } from '../definitions/workspaceMessages';

export function resolveCurrentWorkspaceMessage(
  key: WorkspaceMessageKey,
  params?: Parameters<WorkspaceMessageResolver>[1],
): string {
  const localizationStore = useLocalizationStore();

  return resolveLocalizedText(
    params === undefined
      ? { key, fallback: WORKSPACE_MESSAGE_FALLBACKS[key] }
      : { key, fallback: WORKSPACE_MESSAGE_FALLBACKS[key], params },
    {
      locale: localizationStore.currentLocale,
      fallbackLocale: localizationStore.fallbackLocale,
      resolveMessage: resolveRegisteredMessage,
    },
  );
}
