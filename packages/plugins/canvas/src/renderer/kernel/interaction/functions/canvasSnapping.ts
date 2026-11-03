import type { CanvasCard, CanvasCardId, CanvasPoint } from '../../../../shared';
import type { CanvasSnapTargets } from '../../definitions/canvasInteraction';

/** 手势开始时冻结可见候选，热路径只比较数值，不重新扫描场景或读 DOM。 */
export function createCanvasSnapTargets(cards: readonly CanvasCard[], ids: readonly CanvasCardId[]): CanvasSnapTargets | null {
  const selected = new Set(ids), moving = cards.filter(card => selected.has(card.id) && !card.locked);
  if (!moving.length) return null;
  const x = Math.min(...moving.map(card => card.x)), y = Math.min(...moving.map(card => card.y));
  const bounds = { x, y, width: Math.max(...moving.map(card => card.x + card.width)) - x, height: Math.max(...moving.map(card => card.y + card.height)) - y };
  const candidates = cards.filter(card => !selected.has(card.id)).slice(0, 3000);
  return { bounds, x: candidates.flatMap(card => [card.x, card.x + card.width / 2, card.x + card.width]), y: candidates.flatMap(card => [card.y, card.y + card.height / 2, card.y + card.height]) };
}

function closestDelta(positions: readonly number[], targets: readonly number[], delta: number, threshold: number): number {
  let correction = threshold, found = false;
  for (const position of positions) for (const target of targets) {
    const distance = target - position - delta;
    if (Math.abs(distance) < Math.abs(correction)) { correction = distance; found = true; }
  }
  return delta + (found ? correction : 0);
}

export function snapCanvasMovement(targets: CanvasSnapTargets | null, movement: CanvasPoint, zoom: number): CanvasPoint {
  if (!targets) return movement;
  const { bounds } = targets, threshold = 8 / zoom;
  return { x: closestDelta([bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width], targets.x, movement.x, threshold),
    y: closestDelta([bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height], targets.y, movement.y, threshold) };
}
