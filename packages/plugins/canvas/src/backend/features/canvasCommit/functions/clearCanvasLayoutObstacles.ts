import {
  canvasBounds,
  type CanvasCard,
  type CanvasElementId,
  type CanvasRectangle,
} from '../../../../shared';
import type { CanvasCommitPlan } from '../definitions/canvasCommit';
import { findCanvasPlacement } from './findCanvasPlacement';

/** Worker只决定相对布局；事务内避开期间新出现、锁定或编辑跳过的实际障碍。 */
export function clearCanvasLayoutObstacles(
  plan: CanvasCommitPlan,
  groups: readonly (readonly CanvasElementId[])[],
  reserved: readonly CanvasRectangle[],
  movedIds: ReadonlySet<CanvasElementId>
): CanvasCommitPlan {
  const rows = new Map(plan.state.elements.map(row => [row.element.id, row]));
  const changes = [...plan.changes];
  const eligible = movedIds;
  const lastChanges = new Map(plan.changes.map((change, index) => [change.id, index]));
  const relocated = new Set<CanvasElementId>();
  for (const group of groups) {
    const ids = new Set(group.filter(id => eligible.has(id)));
    const cards = [...rows.values()].flatMap(row =>
      row.element.type !== 'edge' && ids.has(row.element.id) ? [row.element] : []
    );
    const bounds = canvasBounds(cards);
    if (!bounds) continue;
    const occupied: CanvasRectangle[] = [...rows.values()].flatMap(row =>
      row.element.type !== 'edge' && !ids.has(row.element.id) ? [row.element] : []
    );
    occupied.push(...reserved);
    const candidates = (['right', 'left', 'bottom', 'top'] as const).map(side =>
      findCanvasPlacement({ ...bounds, origin: bounds, near: undefined, side, occupied })
    );
    candidates.sort(
      (a, b) =>
        Math.hypot(a.x - bounds.x, a.y - bounds.y) - Math.hypot(b.x - bounds.x, b.y - bounds.y)
    );
    const dx = candidates[0].x - bounds.x,
      dy = candidates[0].y - bounds.y;
    if (dx === 0 && dy === 0) continue;
    for (const card of cards) {
      const row = rows.get(card.id);
      if (!row) throw new Error('canvas_layout_card_missing');
      const element: CanvasCard = { ...card, x: card.x + dx, y: card.y + dy };
      rows.set(card.id, { ...row, element });
      relocated.add(card.id);
      const last = lastChanges.get(card.id);
      if (last === undefined) throw new Error('canvas_layout_change_missing');
      changes[last] = { ...changes[last], after: element };
    }
  }
  return {
    ...plan,
    state: { ...plan.state, elements: [...rows.values()] },
    changes,
    results: plan.results.map(result =>
      result.id && relocated.has(result.id) && result.status === 'applied'
        ? { ...result, reason: 'placed_around_current_obstacle' }
        : result
    ),
  };
}
