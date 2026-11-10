import { shallowReadonly, shallowRef } from 'vue';
import type { CanvasAgentGroup, CanvasCardId } from '@plugin/canvas/shared';
import type { CanvasAgentReviewState, CanvasWithdrawalSummary } from '../definitions/agentReview';
export function createCanvasAgentReviewState(): CanvasAgentReviewState {
  const groups = shallowRef<readonly CanvasAgentGroup[]>([]),
    activeGroupId = shallowRef<string | null>(null);
  const targetId = shallowRef<CanvasCardId | null>(null),
    withdrawal = shallowRef<CanvasWithdrawalSummary | null>(null);
  const busy = shallowRef(false),
    error = shallowRef<string | null>(null);
  return {
    groups: shallowReadonly(groups),
    activeGroupId: shallowReadonly(activeGroupId),
    targetId: shallowReadonly(targetId),
    withdrawal: shallowReadonly(withdrawal),
    busy: shallowReadonly(busy),
    error: shallowReadonly(error),
    install(value, activeId) {
      groups.value = value;
      if (activeId !== activeGroupId.value) targetId.value = null;
      activeGroupId.value = activeId;
    },
    select(id) {
      activeGroupId.value = id;
      targetId.value = null;
    },
    focus(id) {
      targetId.value = id;
    },
    withdrawn(summary) {
      withdrawal.value = summary;
    },
    redone() {
      if (withdrawal.value)
        withdrawal.value = { ...withdrawal.value, mode: 'redo', canRedo: false };
    },
    start() {
      busy.value = true;
      error.value = null;
    },
    finish() {
      busy.value = false;
    },
    fail(message) {
      busy.value = false;
      error.value = message;
    },
  };
}
