import { shallowRef } from 'vue';
import { defineStore } from 'pinia';

/**
 * Renderer 只保存“删除请求仍在等待后端收口”这一条展示事实。
 * 删除是否成功以及各业务状态的清理由 orchestration 决定，store 不发请求、不做跨 store 编排。
 */
export const useConversationDeletionStore = defineStore('conversationDeletion', () => {
  const deletingConversationIds = shallowRef<ReadonlySet<string>>(new Set());

  const isDeletingConversation = (conversationId: string): boolean => (
    deletingConversationIds.value.has(conversationId)
  );

  const beginDeletion = (conversationId: string): void => {
    const next = new Set(deletingConversationIds.value);
    next.add(conversationId);
    deletingConversationIds.value = next;
  };

  const finishDeletion = (conversationId: string): void => {
    if (!deletingConversationIds.value.has(conversationId)) return;
    const next = new Set(deletingConversationIds.value);
    next.delete(conversationId);
    deletingConversationIds.value = next;
  };

  return {
    deletingConversationIds,
    isDeletingConversation,
    beginDeletion,
    finishDeletion,
  };
});
