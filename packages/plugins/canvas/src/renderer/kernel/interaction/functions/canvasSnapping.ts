import type { CanvasCard, CanvasCardId, CanvasPoint } from '../../../../shared';
import type { CanvasGuide } from '../../definitions/canvasKernel';
import type { CanvasSnapAxisTarget, CanvasSnapTargets } from '../../definitions/canvasInteraction';

/** 手势开始时冻结可见候选；超过预算时整次不吸附，不能偏向数组前面的卡。 */
export function createCanvasSnapTargets(cards: readonly CanvasCard[], ids: readonly CanvasCardId[]): CanvasSnapTargets | null {
  const selected = new Set(ids), moving = cards.filter(card => selected.has(card.id) && !card.locked);
  const candidates = cards.filter(card => !selected.has(card.id));
  if (!moving.length || candidates.length > 3000) return null;
  const x = Math.min(...moving.map(card => card.x)), y = Math.min(...moving.map(card => card.y));
  const bounds = { x, y, width: Math.max(...moving.map(card => card.x + card.width)) - x, height: Math.max(...moving.map(card => card.y + card.height)) - y };
  return { bounds,
    x: candidates.flatMap(card => [card.x, card.x + card.width / 2, card.x + card.width].map(value => ({ value, start: card.y, end: card.y + card.height }))),
    y: candidates.flatMap(card => [card.y, card.y + card.height / 2, card.y + card.height].map(value => ({ value, start: card.x, end: card.x + card.width }))),
  };
}

function closestTarget(input: { readonly positions: readonly number[]; readonly targets: readonly CanvasSnapAxisTarget[]; readonly delta: number; readonly threshold: number }) {
  let correction = input.threshold, found: CanvasSnapAxisTarget | null = null;
  for (const position of input.positions) for (const target of input.targets) {
    const distance = target.value - position - input.delta;
    if (Math.abs(distance) < Math.abs(correction)) { correction = distance; found = target; }
  }
  return { delta: input.delta + (found ? correction : 0), target: found };
}

export function snapCanvasMovementWithGuides(targets: CanvasSnapTargets | null, movement: CanvasPoint, zoom: number): { readonly delta: CanvasPoint; readonly guides: readonly CanvasGuide[] } {
  if (!targets) return { delta: movement, guides: [] };
  const { bounds } = targets, threshold = 8 / zoom;
  const x = closestTarget({ positions: [bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width], targets: targets.x, delta: movement.x, threshold });
  const y = closestTarget({ positions: [bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height], targets: targets.y, delta: movement.y, threshold });
  const guides: CanvasGuide[] = [];
  if (x.target) guides.push({ from: { x: x.target.value, y: Math.min(x.target.start, bounds.y + y.delta) }, to: { x: x.target.value, y: Math.max(x.target.end, bounds.y + y.delta + bounds.height) } });
  if (y.target) guides.push({ from: { x: Math.min(y.target.start, bounds.x + x.delta), y: y.target.value }, to: { x: Math.max(y.target.end, bounds.x + x.delta + bounds.width), y: y.target.value } });
  return { delta: { x: x.delta, y: y.delta }, guides };
}

export function snapCanvasMovement(targets: CanvasSnapTargets | null, movement: CanvasPoint, zoom: number): CanvasPoint {
  return snapCanvasMovementWithGuides(targets, movement, zoom).delta;
}
