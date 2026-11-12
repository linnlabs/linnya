import type { Container } from 'pixi.js';
import {
  canvasSectionHeader,
  type CanvasCamera,
  type CanvasCard,
  type CanvasPoint,
} from '../../../../shared';
import type { CanvasCardView } from './definitions/canvasCardView';

/** 场景次序：分区永远在最底层（不论它的 order），其余仍按 order 叠放。 */
export function orderCanvasSceneCards(cards: CanvasCard[]): CanvasCard[] {
  return cards.sort(
    (a, b) =>
      Number(b.type === 'section') - Number(a.type === 'section') ||
      (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)
  );
}

/** 卡片按显示外框命中；分区只有标题条可点，区内空白留给框选、新建和放卡。 */
export function hitsCanvasCardView(card: CanvasCard, view: CanvasCardView, point: CanvasPoint) {
  if (view.container.alpha <= 0) return false;
  const scale = view.container.scale.x;
  const frame = { x: view.container.x, y: view.container.y, width: card.width * scale };
  const height = (card.type === 'section' ? canvasSectionHeader(card).height : card.height) * scale;
  return (
    point.x >= frame.x &&
    point.y >= frame.y &&
    point.x <= frame.x + frame.width &&
    point.y <= frame.y + height
  );
}

/** 分区底层与卡片世界共用同一相机变换。 */
export function placeCanvasWorldLayers(layers: readonly Container[], camera: CanvasCamera): void {
  for (const layer of layers) {
    layer.position.set(camera.x, camera.y);
    layer.scale.set(camera.zoom);
  }
}
