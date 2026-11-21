import {
  canvasBounds,
  type CanvasCard,
  type CanvasElementId,
  type CanvasRectangle,
} from '../../../../shared';
import type { CanvasWorkingPlan } from '../definitions/canvasWorkingPlan';
import { findCanvasPlacement } from './findCanvasPlacement';
import { amendCanvasPlanElement } from './fitCanvasPlanSections';

const cardsOf = (plan: CanvasWorkingPlan): CanvasCard[] =>
  [...plan.elements.values()].flatMap(row => (row.element.type === 'edge' ? [] : [row.element]));

/**
 * 排布移动了分区时，计算位置恰好等于当前位置的成员不会有更新，但它仍按分区内的相对位置摆好，
 * 与分区是一体：不能当作障碍把整组推开，整组平移时也要随分区一起走。锁定或正在编辑的成员不跟随。
 */
function readAttachedMembers(
  plan: CanvasWorkingPlan,
  cards: readonly CanvasCard[],
  ids: ReadonlySet<CanvasElementId>
) {
  const parents = new Set(cards.flatMap(card => (card.parentId ? [card.parentId] : [])));
  const editing = new Set(
    plan.claims.flatMap(claim => (claim.fields.length ? [claim.elementId] : []))
  );
  const attached = cardsOf(plan).filter(
    card =>
      !ids.has(card.id) &&
      card.parentId !== null &&
      (ids.has(card.parentId) || parents.has(card.parentId)) &&
      !card.locked &&
      !editing.has(card.id)
  );
  return {
    parents,
    attached: new Set(attached.map(card => card.id)),
    following: attached.filter(card => card.parentId !== null && ids.has(card.parentId)),
  };
}

/** Worker只决定相对布局；事务内避开期间新出现、锁定或编辑跳过的实际障碍。 */
export function clearCanvasLayoutObstacles(
  plan: CanvasWorkingPlan,
  groups: readonly (readonly CanvasElementId[])[],
  movedIds: ReadonlySet<CanvasElementId>
): void {
  const relocated = new Set<CanvasElementId>();
  for (const group of groups) {
    const ids = new Set(group.filter(id => movedIds.has(id)));
    const cards = cardsOf(plan).filter(card => ids.has(card.id));
    const bounds = canvasBounds(cards);
    if (!bounds) continue;
    // 成员所在的分区包着成员本身，不能当作要避开的障碍。
    const { parents, attached, following } = readAttachedMembers(plan, cards, ids);
    const occupied: CanvasRectangle[] = cardsOf(plan).filter(
      card => !ids.has(card.id) && !parents.has(card.id) && !attached.has(card.id)
    );
    occupied.push(...plan.reservedRectangles);
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
      if (!plan.changes.some(change => change.id === card.id && change.after))
        throw new Error('canvas_layout_change_missing');
      amendCanvasPlanElement(plan, card.id, { x: card.x + dx, y: card.y + dy }, ['x', 'y']);
      relocated.add(card.id);
    }
    for (const card of following)
      amendCanvasPlanElement(plan, card.id, { x: card.x + dx, y: card.y + dy }, ['x', 'y']);
  }
  plan.results = plan.results.map(result =>
    result.id && relocated.has(result.id) && result.status === 'applied'
      ? { ...result, reason: 'placed_around_current_obstacle' }
      : result
  );
}
