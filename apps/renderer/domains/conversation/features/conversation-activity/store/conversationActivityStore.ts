import { defineStore } from 'pinia';
import { shallowRef } from 'vue';
import type { ConversationActivity, ConversationActivityList } from '@app/schemas';

export interface ConversationActivityEntry {
  readonly projectId: string | null;
  readonly activity: ConversationActivity;
}

/** Host 最近一次给出的非空闲对话；不在表里就是空闲。只持有状态，读取与刷新时机在 orchestration。 */
export const useConversationActivityStore = defineStore('conversation-activity', () => {
  const entries = shallowRef<ReadonlyMap<string, ConversationActivityEntry>>(new Map());

  function replace(list: ConversationActivityList): void {
    entries.value = new Map(list.conversations.map(item => [
      item.conversation_id,
      { projectId: item.project_id, activity: item.activity },
    ]));
  }

  return { entries, replace };
});
