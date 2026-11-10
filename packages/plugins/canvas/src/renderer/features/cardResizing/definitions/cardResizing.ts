import type { Ref } from 'vue';
import type { CanvasCard, CanvasRectangle } from '@plugin/canvas/shared';
/** 从哪条边或哪个角拖：n/s/e/w 为上下右左，两字母为角。上边与左边拖动时卡片位置跟着变，对边不动。 */
export type CanvasResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export interface CanvasResizeGesture {
  readonly card: CanvasCard;
  readonly edge: CanvasResizeEdge;
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
