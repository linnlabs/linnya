import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { LocalClientNotice } from '../definitions/clientNotice';

/** 只持有状态；存储和发送属于 orchestration，不由 store 反向调流程。 */
export const useClientNoticeStore = defineStore('conversation-client-notices', () => {
  const entries = ref<LocalClientNotice[]>([]);
  const loaded = ref(false);
  function replace(next: readonly LocalClientNotice[]): void {
    entries.value = [...next];
    loaded.value = true;
  }
  return { entries, loaded, replace };
});
