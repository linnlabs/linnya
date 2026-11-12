import type {
  CanvasCard,
  CanvasCardId,
  CanvasColor,
  CanvasCommand,
  CanvasElement,
} from '@plugin/canvas/shared';

/** 移动分区连同区内的卡：选中分区时把它的成员一并算进移动范围。 */
function withSectionMembers(
  elements: readonly CanvasElement[],
  ids: readonly CanvasCardId[]
): ReadonlySet<CanvasCardId> {
  const moving = new Set(ids);
  for (const element of elements)
    if (element.type !== 'edge' && element.parentId && moving.has(element.parentId))
      moving.add(element.id);
  return moving;
}
export function buildMoveCommands(
  elements: readonly CanvasElement[],
  ids: readonly CanvasCardId[],
  dx: number,
  dy: number
): CanvasCommand[] {
  const moving = withSectionMembers(elements, ids);
  return elements
    .filter(
      (element): element is CanvasCard =>
        element.type !== 'edge' && moving.has(element.id) && !element.locked
    )
    .map(element => {
      return {
        op: 'update',
        id: element.id,
        baseRevision: element.revision,
        patch: { x: element.x + dx, y: element.y + dy },
      };
    });
}
/** 动画中拖动的终点已由视觉起点冻结；读取最新修订提交绝对位置，不再叠加到动画target。 */
export function buildPositionCommands(
  elements: readonly CanvasElement[],
  positions: readonly Pick<CanvasCard, 'id' | 'x' | 'y'>[]
): CanvasCommand[] {
  const desired = new Map(positions.map(position => [position.id, position]));
  // 屏外的成员不在拖动预览里，按所属分区同样的位移补齐。
  const byId = new Map(elements.map(element => [element.id, element]));
  for (const element of elements) {
    if (element.type === 'edge' || !element.parentId || desired.has(element.id)) continue;
    const section = byId.get(element.parentId),
      target = desired.get(element.parentId);
    if (!section || section.type === 'edge' || !target) continue;
    desired.set(element.id, {
      id: element.id,
      x: element.x + target.x - section.x,
      y: element.y + target.y - section.y,
    });
  }
  return elements.flatMap<CanvasCommand>(element => {
    if (element.type === 'edge' || element.locked) return [];
    const point = desired.get(element.id);
    if (!point || (point.x === element.x && point.y === element.y)) return [];
    return [
      {
        op: 'update',
        id: element.id,
        baseRevision: element.revision,
        patch: { x: point.x, y: point.y },
      },
    ];
  });
}
export function buildColorCommands(
  elements: readonly CanvasElement[],
  ids: readonly CanvasCardId[],
  color: CanvasColor
): CanvasCommand[] {
  return elements
    .filter(
      (element): element is CanvasCard =>
        element.type !== 'edge' && ids.includes(element.id) && !element.locked
    )
    .map(element => ({
      op: 'update',
      id: element.id,
      baseRevision: element.revision,
      patch: { color },
    }));
}
export function buildDeleteCommands(
  elements: readonly CanvasElement[],
  ids: readonly CanvasCardId[]
): CanvasCommand[] {
  return elements
    .filter(
      (element): element is CanvasCard =>
        element.type !== 'edge' && ids.includes(element.id) && !element.locked
    )
    .map(element => ({ op: 'delete', id: element.id, baseRevision: element.revision }));
}
