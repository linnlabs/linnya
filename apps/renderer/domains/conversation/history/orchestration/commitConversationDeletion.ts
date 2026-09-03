import type { WorkspaceScope } from '../../../../shared/stores/workspaceScopeStore';
import {
  areWorkspaceScopesEqual,
  useWorkspaceScopeStore,
} from '../../../../shared/stores/workspaceScopeStore';
import { useConversationTitleFeature } from '../../features/conversation-title';
import { useInteractiveRunStore } from '../../features/interactive-run';
import { useMessageWindowStore } from '../../message-window/store/messageWindowStore';
import { useAssistantStore } from '../../store/assistantStore';
import { useConversationState } from '../../store/conversationState';
import { useHistoryListStore } from '../store/historyListStore';
import { useHistoryLoaderStore } from '../store/historyLoaderStore';

/**
 * 后端已经完成完整删除后，Renderer 才一次性丢弃本地 read model。普通删除与失败
 * cleanup 重试必须共用这里，避免其中一条入口遗漏迟到加载、运行或导航状态。
 */
export function prepareConversationDeletionCommit(input: {
  readonly conversationId: string;
  readonly scope: WorkspaceScope;
}): () => void {
  const { conversationId, scope } = input;
  const assistantStore = useAssistantStore();
  const conversationState = useConversationState();
  const historyListStore = useHistoryListStore();
  const historyLoaderStore = useHistoryLoaderStore();
  const interactiveRunStore = useInteractiveRunStore();
  const messageWindowStore = useMessageWindowStore();
  const titleFeature = useConversationTitleFeature();
  const workspaceScopeStore = useWorkspaceScopeStore();
  return () => {
    const isActiveAtCommit = conversationState.activeConversationId === conversationId;
    titleFeature.discardConversation(conversationId);
    const loadingInvalidation = historyLoaderStore.forgetConversation(conversationId);
    if (loadingInvalidation.bufferRequestToken !== null) {
      assistantStore.discardHistoryLoadingSseBuffer(
        conversationId,
        loadingInvalidation.bufferRequestToken,
        'conversation-deleted',
      );
    }
    if (
      loadingInvalidation.ownsLoadingState
      && conversationState.historyLoadingConversationId === conversationId
    ) {
      conversationState.setHistoryLoadingConversation(null);
    }
    assistantStore.cleanupConversationProjection(conversationId);
    interactiveRunStore.abortTransport(conversationId);
    interactiveRunStore.synchronizeSnapshot(conversationId, undefined);

    if (assistantStore.selectedConversationId === conversationId) {
      assistantStore.setSelectedConversation(null);
    }
    if (messageWindowStore.conversationId === conversationId) {
      messageWindowStore.clear();
    }

    historyListStore.forgetConversation(conversationId);
    if (conversationState.conversations.some(conversation => conversation.id === conversationId)) {
      conversationState.deleteConversation(conversationId);
    }
    if (workspaceScopeStore.getLastActiveConversation(scope) === conversationId) {
      workspaceScopeStore.forgetLastActiveConversation(scope);
    }
    if (
      isActiveAtCommit
      && areWorkspaceScopesEqual(workspaceScopeStore.currentScope, scope)
    ) {
      workspaceScopeStore.startDraft(scope);
      assistantStore.clearError();
    }
  };
}
