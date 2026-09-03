import { ref } from 'vue';
import { defineStore } from 'pinia';

export const useSubrunTraceInvalidationStore = defineStore(
  'conversationSubrunTraceInvalidation',
  () => {
    const revisionByConversation = ref(new Map<string, number>());

    /** Host 已确认 durable settlement 后，通知已展开的 trace 重新读取正式事实。 */
    const invalidateConversation = (conversationId: string): void => {
      const current = revisionByConversation.value.get(conversationId) ?? 0;
      revisionByConversation.value.set(conversationId, current + 1);
    };

    const revisionFor = (conversationId: string): number => (
      revisionByConversation.value.get(conversationId) ?? 0
    );

    return {
      revisionByConversation,
      invalidateConversation,
      revisionFor,
    };
  },
);
