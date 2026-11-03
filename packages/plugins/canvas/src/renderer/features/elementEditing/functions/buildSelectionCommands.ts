import type { CanvasCard, CanvasCardId, CanvasColor, CanvasCommand, CanvasElement } from '@plugin/canvas/shared';

export function buildMoveCommands(elements: readonly CanvasElement[], ids: readonly CanvasCardId[], dx: number, dy: number): CanvasCommand[] {
  return elements.filter((element): element is CanvasCard => element.type !== 'edge' && ids.includes(element.id) && !element.locked).map(element => {
    return { op: 'update', id: element.id, baseRevision: element.revision, patch: { x: element.x + dx, y: element.y + dy } };
  });
}
export function buildColorCommands(elements: readonly CanvasElement[], ids: readonly CanvasCardId[], color: CanvasColor): CanvasCommand[] {
  return elements.filter((element): element is CanvasCard => element.type !== 'edge' && ids.includes(element.id) && !element.locked).map(element => ({ op: 'update', id: element.id, baseRevision: element.revision, patch: { color } }));
}
export function buildDeleteCommands(elements: readonly CanvasElement[], ids: readonly CanvasCardId[]): CanvasCommand[] {
  return elements.filter((element): element is CanvasCard => element.type !== 'edge' && ids.includes(element.id) && !element.locked).map(element => ({ op: 'delete', id: element.id, baseRevision: element.revision }));
}
