import { parseUserFacingMessage } from '@app/schemas';
import { WORKSPACE_MESSAGE_FALLBACKS } from '../definitions/workspaceMessageCatalog';
import type { WorkspaceOperationFailure } from '../definitions/workspaceOperationFailure';
import type { WorkspaceMessageKey, WorkspaceMessageResolver } from '../definitions/workspaceMessages';

function isWorkspaceMessageKey(key: string): key is WorkspaceMessageKey {
  return Object.prototype.hasOwnProperty.call(WORKSPACE_MESSAGE_FALLBACKS, key);
}

export function resolveWorkspaceOperationFailure(
  failure: WorkspaceOperationFailure,
  workspaceMessage: WorkspaceMessageResolver,
  fallbackKey: WorkspaceMessageKey,
): string {
  const message = parseUserFacingMessage(failure.userMessage);
  if (message && isWorkspaceMessageKey(message.key)) {
    return workspaceMessage(message.key, message.params);
  }

  return workspaceMessage(fallbackKey);
}
