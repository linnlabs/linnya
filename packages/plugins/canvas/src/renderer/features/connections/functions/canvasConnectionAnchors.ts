import type { CanvasCard, CanvasEndpoint, CanvasPoint } from '@plugin/canvas/shared';
/**
 * 四边中点的连线圆点。inset 是从几何边向内的距离（世界坐标），由宿主按选中描边中线给出，
 * 使圆点压在看得见的卡边上；不传时落在几何边。
 */
export function canvasConnectionAnchors(card: CanvasCard, inset = 0) {
  const cx = card.x + card.width / 2,
    cy = card.y + card.height / 2;
  return [
    { side: 'top' as const, x: cx, y: card.y + inset },
    { side: 'right' as const, x: card.x + card.width - inset, y: cy },
    { side: 'bottom' as const, x: cx, y: card.y + card.height - inset },
    { side: 'left' as const, x: card.x + inset, y: cy },
  ];
}
export function canvasEndpointAt(
  point: CanvasPoint,
  cards: readonly CanvasCard[],
  zoom: number,
  inset = 0
): CanvasEndpoint {
  // 圆点直径按屏幕16px，与画出来的圆点同心；落在卡片内而非圆点时使用自动端点。
  const radius = 8 / zoom;
  const dot = cards
    .flatMap(card => canvasConnectionAnchors(card, inset).map(anchor => ({ card, anchor })))
    .find(({ anchor }) => Math.hypot(anchor.x - point.x, anchor.y - point.y) <= radius);
  if (dot) return { kind: 'card', cardId: dot.card.id, side: dot.anchor.side };
  const card = [...cards]
    .reverse()
    .find(
      value =>
        point.x >= value.x &&
        point.x <= value.x + value.width &&
        point.y >= value.y &&
        point.y <= value.y + value.height
    );
  if (!card) return { kind: 'point', ...point };
  return { kind: 'card', cardId: card.id, side: 'auto' };
}
