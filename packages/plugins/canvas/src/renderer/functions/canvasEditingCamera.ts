import type { CanvasCamera, CanvasCard } from '@plugin/canvas/shared';
/** 长卡只定位顶部，不能fit整篇后继续用不可读字号编辑。 */
export function canvasEditingCamera(card: CanvasCard, current: CanvasCamera): CanvasCamera | null {
  return current.zoom < 0.3 ? { zoom: 1, x: 48 - card.x, y: 96 - card.y } : null;
}
