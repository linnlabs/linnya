import type { Ref } from 'vue';
import type { CanvasCard, CanvasRectangle } from '@plugin/canvas/shared';
export interface CanvasResizeGesture {
  readonly card: CanvasCard;
  readonly pointer: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly zoom: number;
  readonly target: HTMLElement;
}
export interface CanvasResizeState {
  readonly preview: Readonly<Ref<CanvasRectangle | null>>;
  set(preview: CanvasRectangle | null): void;
}
