import { shallowRef } from 'vue';
import type { HistoryPanelState } from '../definitions/historyPanel';

export function createHistoryPanelState() {
  const state = shallowRef<HistoryPanelState>({
    phase: 'loading',
    recent: [],
    earlier: [],
    selectedId: null,
    error: null,
    restored: false,
  });
  return {
    state,
    set: (value: HistoryPanelState): void => {
      state.value = value;
    },
  };
}
