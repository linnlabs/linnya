import { defineStore } from 'pinia';
import { shallowRef } from 'vue';

/**
 * 用户点开过的“已工作”折叠行，按对话分开记。只在本次打开应用期间有效，不持久化：
 * 重开应用后历史轮次照常收起。ConversationView 随切换对话重建，所以放在 store 而不是组件里。
 */
export const useTurnWorkFoldStore = defineStore('conversation-turn-work-fold', () => {
  const expandedByConversation = shallowRef<ReadonlyMap<string, ReadonlySet<string>>>(new Map());

  function isExpanded(conversationId: string, rootUserMessageId: string): boolean {
    return expandedByConversation.value.get(conversationId)?.has(rootUserMessageId) ?? false;
  }

  function setExpanded(conversationId: string, rootUserMessageId: string, expanded: boolean): void {
    const current = expandedByConversation.value.get(conversationId) ?? new Set<string>();
    if (current.has(rootUserMessageId) === expanded) return;
    const nextSet = new Set(current);
    if (expanded) nextSet.add(rootUserMessageId);
    else nextSet.delete(rootUserMessageId);
    const next = new Map(expandedByConversation.value);
    if (nextSet.size > 0) next.set(conversationId, nextSet);
    else next.delete(conversationId);
    expandedByConversation.value = next;
  }

  return { expandedByConversation, isExpanded, setExpanded };
});
