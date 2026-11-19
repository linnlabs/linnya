import { computed, shallowRef } from 'vue';
import type { ConversationCommandPermissionView } from '@app/schemas/commands';

import type { ConversationCommandPermissionState } from '../definitions/conversationCommandPermissionState';

export function createConversationCommandPermissionState() {
  const state = shallowRef<ConversationCommandPermissionState>({
    loadState: 'loading', busy: false,
  });
  return {
    current: computed(() => state.value.current),
    loadState: computed(() => state.value.loadState),
    busy: computed(() => state.value.busy),
    resetView() {
      state.value = { ...state.value, current: undefined, loadState: 'loading' };
    },
    receive(current: ConversationCommandPermissionView | undefined) {
      state.value = { ...state.value, current, loadState: current ? 'ready' : 'unavailable' };
    },
    setBusy(busy: boolean) {
      state.value = { ...state.value, busy };
    },
  };
}
