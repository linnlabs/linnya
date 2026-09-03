import type { WorkspaceScope } from '../../../../shared/stores/workspaceScopeStore';
import { deleteConversationFromHistory } from './deleteConversationFromHistory';

export interface DeleteConversationsFromHistoryInput {
  readonly conversationIds: readonly string[];
  readonly scope: WorkspaceScope;
}

export interface DeleteConversationsFromHistoryResult {
  readonly succeededIds: readonly string[];
  readonly failedIds: readonly string[];
}

export async function deleteConversationsFromHistory(
  input: DeleteConversationsFromHistoryInput,
): Promise<DeleteConversationsFromHistoryResult> {
  const conversationIds = [...new Set(input.conversationIds.map(id => id.trim()).filter(Boolean))];
  if (conversationIds.length === 0) throw new Error('conversationIds are required');

  const results = await Promise.allSettled(
    conversationIds.map(conversationId => deleteConversationFromHistory({ conversationId, scope: input.scope })),
  );
  return {
    succeededIds: conversationIds.filter((_, index) => results[index]?.status === 'fulfilled'),
    failedIds: conversationIds.filter((_, index) => results[index]?.status === 'rejected'),
  };
}
