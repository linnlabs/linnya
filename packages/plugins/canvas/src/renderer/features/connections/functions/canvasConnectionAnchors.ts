import type { CanvasCard, CanvasEndpoint, CanvasPoint } from '@plugin/canvas/shared';
export function canvasConnectionAnchors(card: CanvasCard) {
  return [{ side: 'top' as const, x: card.x + card.width / 2, y: card.y }, { side: 'right' as const, x: card.x + card.width, y: card.y + card.height / 2 },
    { side: 'bottom' as const, x: card.x + card.width / 2, y: card.y + card.height }, { side: 'left' as const, x: card.x, y: card.y + card.height / 2 }];
}
export function canvasEndpointAt(point: CanvasPoint, card: CanvasCard | null): CanvasEndpoint {
  if (!card) return { kind: 'point', ...point };
  const nearest = canvasConnectionAnchors(card).reduce((previous, anchor) => Math.hypot(anchor.x - point.x, anchor.y - point.y) < Math.hypot(previous.x - point.x, previous.y - point.y) ? anchor : previous);
  return { kind: 'card', cardId: card.id, side: nearest.side };
}
