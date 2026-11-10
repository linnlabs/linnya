import { shallowReadonly, shallowRef } from 'vue';
import type { CanvasEdgeId } from '@plugin/canvas/shared';

export function createCanvasLabelPreviewState() {
  const id = shallowRef<CanvasEdgeId | null>(null),
    inside = shallowRef(false);
  return {
    id: shallowReadonly(id),
    inside: shallowReadonly(inside),
    show(value: CanvasEdgeId) {
      id.value = value;
    },
    enter() {
      inside.value = true;
    },
    leave() {
      inside.value = false;
    },
    clear() {
      id.value = null;
      inside.value = false;
    },
  };
}
