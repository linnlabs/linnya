export type HistoryLoadingShellRollbackAction =
  | 'skip-newer-same-conversation'
  | 'ignore-missing-conversation'
  | 'ignore-unowned-conversation'
  | 'restore-fallback'
  | 'remove-shell';

export interface ResolveHistoryLoadingShellRollbackActionInput {
  shellRequestToken: number;
  ownedShellRequestToken: number | null;
  hasExistingConversation: boolean;
  hasFallbackConversation: boolean;
}

export function resolveHistoryLoadingShellRollbackAction(
  input: ResolveHistoryLoadingShellRollbackActionInput,
): HistoryLoadingShellRollbackAction {
  if (!input.hasExistingConversation) {
    return 'ignore-missing-conversation';
  }

  if (input.ownedShellRequestToken === null) {
    return 'ignore-unowned-conversation';
  }

  if (input.ownedShellRequestToken !== input.shellRequestToken) {
    return 'skip-newer-same-conversation';
  }

  return input.hasFallbackConversation ? 'restore-fallback' : 'remove-shell';
}
