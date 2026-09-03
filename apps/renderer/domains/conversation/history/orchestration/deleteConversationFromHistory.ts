import type { WorkspaceScope } from '../../../../shared/stores/workspaceScopeStore';
import { historyApiService } from '../services/historyApiService';
import { useConversationDeletionStore } from '../store/conversationDeletionStore';
import { useHistoryListStore } from '../store/historyListStore';
import { prepareConversationDeletionCommit } from './commitConversationDeletion';

export interface DeleteConversationFromHistoryInput {
  readonly conversationId: string;
  readonly scope: WorkspaceScope;
}

const inFlightDeletions = new Map<string, Promise<void>>();

async function performConversationDeletion(input: DeleteConversationFromHistoryInput): Promise<void> {
  const { conversationId, scope } = input;
  const deletionStore = useConversationDeletionStore();
  const commitDeletion = prepareConversationDeletionCommit({ conversationId, scope });

  deletionStore.beginDeletion(conversationId);
  try {
    await historyApiService.deleteConversation(conversationId);
    commitDeletion();
  } finally {
    deletionStore.finishDeletion(conversationId);
  }
}

async function performPendingCleanupRetry(input: DeleteConversationFromHistoryInput): Promise<void> {
  const { conversationId, scope } = input;
  const deletionStore = useConversationDeletionStore();
  const commitDeletion = prepareConversationDeletionCommit({ conversationId, scope });
  deletionStore.beginDeletion(conversationId);
  try {
    const outcome = await historyApiService.retryPendingCleanup(conversationId);
    if (outcome === 'conversation_deleted') {
      commitDeletion();
      return;
    }
    if (outcome === 'still_pending') {
      throw new Error('conversation cleanup is still pending');
    }
    useHistoryListStore().updateConversation(conversationId, { cleanup_pending: false });
  } finally {
    deletionStore.finishDeletion(conversationId);
  }
}

/**
 * 删除事实只有后端成功后才提交到 Renderer。
 * 同一对话的重复入口共享同一个 Promise，既不重复弹出本地清理流程，也不会发出第二个 DELETE。
 */
export function deleteConversationFromHistory(
  input: DeleteConversationFromHistoryInput,
): Promise<void> {
  const conversationId = input.conversationId.trim();
  if (!conversationId) {
    return Promise.reject(new Error('conversationId is required'));
  }

  const existing = inFlightDeletions.get(conversationId);
  if (existing) return existing;

  const operation = performConversationDeletion({
    conversationId,
    scope: input.scope,
  }).finally(() => {
    if (inFlightDeletions.get(conversationId) === operation) {
      inFlightDeletions.delete(conversationId);
    }
  });
  inFlightDeletions.set(conversationId, operation);
  return operation;
}

export function retryConversationCleanupFromHistory(
  input: DeleteConversationFromHistoryInput,
): Promise<void> {
  const conversationId = input.conversationId.trim();
  if (!conversationId) return Promise.reject(new Error('conversationId is required'));
  const existing = inFlightDeletions.get(conversationId);
  if (existing) return existing;
  const operation = performPendingCleanupRetry({
    conversationId,
    scope: input.scope,
  }).finally(() => {
    if (inFlightDeletions.get(conversationId) === operation) {
      inFlightDeletions.delete(conversationId);
    }
  });
  inFlightDeletions.set(conversationId, operation);
  return operation;
}
