import { defineStore } from 'pinia';
import { ref } from 'vue';

/**
 * 一条待送达的插话。
 * - queued：还没交给 Host（运行还没有身份，或要转为下一次运行）；
 * - sending：正在交给 Host；
 * - pending：Host 已接纳，等一批工具结算后送达。
 */
export interface RunSteerItem {
  readonly inputId: string;
  readonly content: string;
  readonly runId?: string;
  readonly state: 'queued' | 'sending' | 'pending';
}

/** 按对话保存待送达的插话；只在内存里，与输入框草稿一样不跨重启保存。 */
export const useRunSteeringStore = defineStore('conversationRunSteering', () => {
  const byConversation = ref<Record<string, RunSteerItem[]>>({});

  function itemsFor(conversationId: string | null | undefined): readonly RunSteerItem[] {
    if (!conversationId) return [];
    return byConversation.value[conversationId] ?? [];
  }

  function add(conversationId: string, item: RunSteerItem): void {
    byConversation.value = {
      ...byConversation.value,
      [conversationId]: [...itemsFor(conversationId), item],
    };
  }

  function update(conversationId: string, inputId: string, patch: Partial<RunSteerItem>): void {
    byConversation.value = {
      ...byConversation.value,
      [conversationId]: itemsFor(conversationId).map(item =>
        item.inputId === inputId ? { ...item, ...patch } : item),
    };
  }

  function remove(conversationId: string, inputIds: readonly string[]): void {
    if (inputIds.length === 0) return;
    const next = itemsFor(conversationId).filter(item => !inputIds.includes(item.inputId));
    const copy = { ...byConversation.value };
    if (next.length === 0) delete copy[conversationId];
    else copy[conversationId] = next;
    byConversation.value = copy;
  }

  return { byConversation, itemsFor, add, update, remove };
});
