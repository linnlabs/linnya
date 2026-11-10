import { shallowRef } from 'vue';
import type { BacklinksPanelState } from '../definitions/backlinksPanel';
export function createBacklinksPanelState() {
  const state = shallowRef<BacklinksPanelState>({
    phase: 'loading',
    documents: [],
    documentCount: 0,
    referenceCount: 0,
    nextOffset: null,
    error: false,
  });
  return {
    state,
    set(value: BacklinksPanelState): void {
      state.value = value;
    },
  };
}
