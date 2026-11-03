import type { CanvasCard, CanvasCardId, CanvasColor, CanvasCommand, CanvasElement } from '@plugin/canvas/shared';

export function buildMoveCommands(elements: readonly CanvasElement[], ids: readonly CanvasCardId[], dx: number, dy: number): CanvasCommand[] {
  return elements.filter((element): element is CanvasCard => element.type !== 'edge' && ids.includes(element.id) && !element.locked).map(element => {
    return { op: 'update', id: element.id, baseRevision: element.revision, patch: { x: element.x + dx, y: element.y + dy } };
  });
}
/** 动画中拖动的终点已由视觉起点冻结；读取最新修订提交绝对位置，不再叠加到动画target。 */
export function buildPositionCommands(elements: readonly CanvasElement[], positions: readonly Pick<CanvasCard, 'id' | 'x' | 'y'>[]): CanvasCommand[] {
  const desired = new Map(positions.map(position => [position.id, position]));
  return elements.flatMap<CanvasCommand>(element => {
    if (element.type === 'edge' || element.locked) return [];
    const point = desired.get(element.id);
    if (!point || point.x === element.x && point.y === element.y) return [];
    return [{ op: 'update', id: element.id, baseRevision: element.revision, patch: { x: point.x, y: point.y } }];
  });
}
export function buildColorCommands(elements: readonly CanvasElement[], ids: readonly CanvasCardId[], color: CanvasColor): CanvasCommand[] {
  return elements.filter((element): element is CanvasCard => element.type !== 'edge' && ids.includes(element.id) && !element.locked).map(element => ({ op: 'update', id: element.id, baseRevision: element.revision, patch: { color } }));
}
export function buildDeleteCommands(elements: readonly CanvasElement[], ids: readonly CanvasCardId[]): CanvasCommand[] {
  return elements.filter((element): element is CanvasCard => element.type !== 'edge' && ids.includes(element.id) && !element.locked).map(element => ({ op: 'delete', id: element.id, baseRevision: element.revision }));
}
