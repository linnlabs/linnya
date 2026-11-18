import { computed, shallowRef } from 'vue';
import type { ConversationCommandPermissionView } from '@app/schemas/commands';

import type { ConversationCommandPermissionState } from '../definitions/conversationCommandPermissionState';

export function createConversationCommandPermissionState() {
  const state = shallowRef<ConversationCommandPermissionState>({
    loadState: 'loading', busy: false, writeFailure: false,
  });
  return {
    current: computed(() => state.value.current),
    loadState: computed(() => state.value.loadState),
    busy: computed(() => state.value.busy),
    writeFailure: computed(() => state.value.writeFailure),
    resetView() {
      state.value = { ...state.value, current: undefined, loadState: 'loading', writeFailure: false };
    },
    receive(current: ConversationCommandPermissionView | undefined) {
      state.value = { ...state.value, current, loadState: current ? 'ready' : 'unavailable' };
    },
    setBusy(busy: boolean) {
      state.value = { ...state.value, busy };
    },
    setWriteFailure(writeFailure: boolean) {
      state.value = { ...state.value, writeFailure };
    },
  };
}
