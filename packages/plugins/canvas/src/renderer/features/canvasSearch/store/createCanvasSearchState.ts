import { shallowReadonly, shallowRef } from 'vue';
import type { CanvasSearchState } from '../definitions/canvasSearchState';
export function createCanvasSearchState(): CanvasSearchState {
  const open = shallowRef(false),
    query = shallowRef(''),
    index = shallowRef(0);
  return {
    open: shallowReadonly(open),
    query: shallowReadonly(query),
    index: shallowReadonly(index),
    show() {
      open.value = true;
    },
    close() {
      open.value = false;
    },
    setQuery(value) {
      query.value = value;
      index.value = 0;
    },
    select(value) {
      index.value = value;
    },
  };
}
