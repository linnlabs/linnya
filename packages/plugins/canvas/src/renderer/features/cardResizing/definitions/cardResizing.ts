import type { Ref } from 'vue';
import type { CanvasCard, CanvasRectangle } from '@plugin/canvas/shared';
export interface CanvasResizeGesture {
  readonly card: CanvasCard;
  readonly pointer: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly zoom: number;
  readonly target: HTMLElement;
  readonly display: CanvasResizeDisplay;
}
/**
 * 画布上的实时改尺寸投影：拖动中纸面、阴影、连线与选中描边逐帧跟随，正文沿用旧排版并裁在纸面内；
 * 提交落地（或取消）后再撤掉投影，避免松手瞬间先弹回旧尺寸。
 */
export interface CanvasResizeDisplay {
  show(rectangle: CanvasRectangle): void;
  clear(): void;
}
export interface CanvasResizeState {
  readonly preview: Readonly<Ref<CanvasRectangle | null>>;
  set(preview: CanvasRectangle | null): void;
}
