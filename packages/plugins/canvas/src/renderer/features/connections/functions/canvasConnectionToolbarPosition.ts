import type { CanvasPoint, CanvasRectangle } from '@plugin/canvas/shared';

const overlaps = (a: CanvasRectangle, b: CanvasRectangle) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
function lineIntersects(rectangle: CanvasRectangle, from: CanvasPoint, to: CanvasPoint): boolean {
  let low = 0, high = 1;
  for (const axis of ['x', 'y'] as const) {
    const delta = to[axis] - from[axis], start = rectangle[axis], end = start + (axis === 'x' ? rectangle.width : rectangle.height);
    if (!delta) { if (from[axis] < start || from[axis] > end) return false; continue; }
    const first = (start - from[axis]) / delta, last = (end - from[axis]) / delta;
    low = Math.max(low, Math.min(first, last)); high = Math.min(high, Math.max(first, last));
    if (low > high) return false;
  }
  return true;
}
/** 与线中点共同投影；按约定上/下/右/左尝试三档间距，避免盖住卡、线和标签。 */
export function canvasConnectionToolbarPosition(input: {
  readonly midpoint: CanvasPoint; readonly size: { readonly width: number; readonly height: number };
  readonly viewport: { readonly width: number; readonly height: number }; readonly cards: readonly CanvasRectangle[];
  readonly line: readonly CanvasPoint[]; readonly label: CanvasRectangle | null;
}): CanvasPoint {
  const { midpoint: point, size, viewport } = input;
  const candidates = [
    ...[14, 40, 80].map(gap => ({ x: point.x - size.width / 2, y: point.y - size.height - gap })),
    ...[14, 40, 80].map(gap => ({ x: point.x - size.width / 2, y: point.y + gap })),
    ...[14, 40, 80].map(gap => ({ x: point.x + gap, y: point.y - size.height / 2 })),
    ...[14, 40, 80].map(gap => ({ x: point.x - size.width - gap, y: point.y - size.height / 2 })),
  ];
  const available = candidates.find(candidate => {
    const rectangle = { ...candidate, ...size };
    if (candidate.x < 8 || candidate.y < 8 || candidate.x + size.width > viewport.width - 8 || candidate.y + size.height > viewport.height - 8) return false;
    if (input.cards.some(card => overlaps(rectangle, card)) || input.label && overlaps(rectangle, input.label)) return false;
    return !input.line.slice(1).some((point, index) => lineIntersects(rectangle, input.line[index], point));
  });
  return available ?? { x: Math.max(8, Math.min(point.x - size.width / 2, viewport.width - size.width - 8)), y: Math.max(8, point.y - size.height - 14) };
}
