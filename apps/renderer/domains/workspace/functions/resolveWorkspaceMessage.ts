import type { MessageParams } from '@app/localization';
import { WORKSPACE_MESSAGE_FALLBACKS } from '../definitions/workspaceMessageCatalog';
import type { WorkspaceMessageKey, WorkspaceMessageResolver } from '../definitions/workspaceMessages';

export type WorkspaceRawMessageResolver = (
  key: string,
  fallback: string,
  params?: MessageParams,
) => string;

export function resolveWorkspaceMessage(
  key: WorkspaceMessageKey,
  resolveMessage: WorkspaceRawMessageResolver,
  params?: MessageParams,
): string {
  return resolveMessage(key, WORKSPACE_MESSAGE_FALLBACKS[key], params);
}

export function createWorkspaceMessageResolver(
  resolveMessage: WorkspaceRawMessageResolver,
): WorkspaceMessageResolver {
  return (key, params) => resolveWorkspaceMessage(key, resolveMessage, params);
}
