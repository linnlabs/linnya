import { shallowReadonly, shallowRef } from 'vue';
import type { CanvasCardId } from '@plugin/canvas/shared';

export function createCanvasSelection() {
  const ids = shallowRef<readonly CanvasCardId[]>([]);
  return {
    ids: shallowReadonly(ids),
    select(value: readonly CanvasCardId[]) {
      ids.value = value;
    },
  };
}
