import { shallowReadonly, shallowRef } from 'vue';
import type { CanvasAgentGroup } from '@plugin/canvas/shared';
import type { CanvasAgentReviewState } from '../definitions/agentReview';
export function createCanvasAgentReviewState(): CanvasAgentReviewState {
  const groups = shallowRef<readonly CanvasAgentGroup[]>([]), activeGroupId = shallowRef<string | null>(null);
  const busy = shallowRef(false), error = shallowRef<string | null>(null);
  return { groups: shallowReadonly(groups), activeGroupId: shallowReadonly(activeGroupId), busy: shallowReadonly(busy), error: shallowReadonly(error),
    install(value) { groups.value = value; error.value = null; }, select(id) { activeGroupId.value = id; },
    start() { busy.value = true; error.value = null; }, finish() { busy.value = false; }, fail(message) { busy.value = false; error.value = message; } };
}
