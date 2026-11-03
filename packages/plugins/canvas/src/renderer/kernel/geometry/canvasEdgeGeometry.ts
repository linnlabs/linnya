import type { CanvasCard, CanvasEdge, CanvasEndpoint, CanvasPoint } from '../../../shared';

function anchor(endpoint: CanvasEndpoint, cards: ReadonlyMap<string, CanvasCard>, toward: CanvasPoint): CanvasPoint {
  if (endpoint.kind === 'point') return endpoint;
  const card = cards.get(endpoint.cardId);
  if (!card) return toward;
  const cx = card.x + card.width / 2;
  const cy = card.y + card.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  const side = endpoint.side === 'auto'
    ? Math.abs(dx) / card.width >= Math.abs(dy) / card.height ? dx >= 0 ? 'right' : 'left' : dy >= 0 ? 'bottom' : 'top'
    : endpoint.side;
  switch (side) {
    case 'left': return { x: card.x, y: cy };
    case 'right': return { x: card.x + card.width, y: cy };
    case 'top': return { x: cx, y: card.y };
    case 'bottom': return { x: cx, y: card.y + card.height };
  }
}
function center(endpoint: CanvasEndpoint, cards: ReadonlyMap<string, CanvasCard>): CanvasPoint {
  if (endpoint.kind === 'point') return endpoint;
  const card = cards.get(endpoint.cardId);
  return card ? { x: card.x + card.width / 2, y: card.y + card.height / 2 } : { x: 0, y: 0 };
}

/** 不调用 Pixi 的贝塞尔细分，长边也遵守有界的屏幕采样步长。 */
export function canvasEdgePoints(edge: CanvasEdge, cards: ReadonlyMap<string, CanvasCard>, zoom: number): readonly CanvasPoint[] {
  const from = anchor(edge.from, cards, center(edge.to, cards));
  const to = anchor(edge.to, cards, center(edge.from, cards));
  if (edge.lineStyle === 'straight' || zoom < 0.15) return [from, to];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const control = Math.min(180, Math.max(24, Math.hypot(dx, dy) * 0.25));
  const direction = horizontal ? Math.sign(dx) || 1 : Math.sign(dy) || 1;
  const c1 = { x: from.x + (horizontal ? control * direction : 0), y: from.y + (horizontal ? 0 : control * direction) };
  const c2 = { x: to.x - (horizontal ? control * direction : 0), y: to.y - (horizontal ? 0 : control * direction) };
  const count = Math.min(128, Math.max(2, Math.ceil(Math.hypot(dx, dy) * zoom / 12)));
  return Array.from({ length: count + 1 }, (_, i) => {
    const t = i / count;
    const s = 1 - t;
    return { x: s ** 3 * from.x + 3 * s ** 2 * t * c1.x + 3 * s * t ** 2 * c2.x + t ** 3 * to.x,
      y: s ** 3 * from.y + 3 * s ** 2 * t * c1.y + 3 * s * t ** 2 * c2.y + t ** 3 * to.y };
  });
}
