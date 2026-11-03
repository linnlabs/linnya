import { shallowReadonly, shallowRef } from 'vue';
import type { CanvasRectangle } from '@plugin/canvas/shared';
import type { CanvasResizeState } from '../definitions/cardResizing';
export function createCanvasResizeState(): CanvasResizeState {
  const preview = shallowRef<CanvasRectangle | null>(null);
  return { preview: shallowReadonly(preview), set(value) { preview.value = value; } };
}
