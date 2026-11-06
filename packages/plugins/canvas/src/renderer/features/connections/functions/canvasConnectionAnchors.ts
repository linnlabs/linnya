import type { CanvasCard, CanvasEndpoint, CanvasPoint } from '@plugin/canvas/shared';
export function canvasConnectionAnchors(card: CanvasCard) {
  return [
    { side: 'top' as const, x: card.x + card.width / 2, y: card.y },
    { side: 'right' as const, x: card.x + card.width, y: card.y + card.height / 2 },
    { side: 'bottom' as const, x: card.x + card.width / 2, y: card.y + card.height },
    { side: 'left' as const, x: card.x, y: card.y + card.height / 2 },
  ];
}
export function canvasEndpointAt(
  point: CanvasPoint,
  cards: readonly CanvasCard[],
  zoom: number
): CanvasEndpoint {
  // 圆点直径按屏幕16px；落在卡片内而非圆点时使用自动端点。
  const radius = 8 / zoom;
  const dot = cards
    .flatMap(card => canvasConnectionAnchors(card).map(anchor => ({ card, anchor })))
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
