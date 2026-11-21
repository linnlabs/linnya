import { defineStore } from 'pinia';
import { getRendererPersistStorage } from '@/shared/persistence/rendererPersistStorage';

/**
 * “看过哪次中断”，存在 Renderer 持久存储，重启后保留。按运行编号记：同一对话的新中断
 * 会重新出现。baselineAt 在首次启用时写入，更早结束的中断算看过。
 */
export const useConversationActivitySeenStore = defineStore('conversation-activity-seen', {
  state: () => ({
    baselineAt: 0,
    seenRunIds: {} as Record<string, string>,
  }),

  actions: {
    ensureBaseline(now: number) {
      if (this.baselineAt === 0) this.baselineAt = now;
    },
    markSeen(conversationId: string, runId: string) {
      if (this.seenRunIds[conversationId] === runId) return;
      this.seenRunIds = { ...this.seenRunIds, [conversationId]: runId };
    },
    replaceSeenRunIds(next: Record<string, string>) {
      const current = Object.entries(this.seenRunIds);
      if (current.length === Object.keys(next).length && current.every(([id, runId]) => next[id] === runId)) return;
      this.seenRunIds = next;
    },
  },

  persist: {
    key: 'conversation-activity-seen',
    storage: getRendererPersistStorage(),
    pick: ['baselineAt', 'seenRunIds'],
  },
});
