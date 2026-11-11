import { defineStore } from 'pinia';
import type { HistoryLoadingState } from '../definitions/historyLoader';
export const useHistoryLoadingState = defineStore('historyLoader', {
  state: (): HistoryLoadingState => ({
    isLoading: false,
    loadingConversationId: null,
    error: null,
    loadedConversationId: null,
  }),
  actions: {
    patchLoadingState(changes: Partial<HistoryLoadingState>) {
      Object.assign(this, changes);
    },
  },
});
