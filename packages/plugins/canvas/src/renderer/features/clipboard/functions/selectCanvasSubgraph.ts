import type { CanvasCardId, CanvasElement } from '@plugin/canvas/shared';
export function selectCanvasSubgraph(
  elements: readonly CanvasElement[],
  ids: readonly CanvasCardId[]
): CanvasElement[] {
  return elements.filter(element =>
    element.type !== 'edge'
      ? ids.includes(element.id)
      : element.from.kind === 'card' &&
        element.to.kind === 'card' &&
        ids.includes(element.from.cardId) &&
        ids.includes(element.to.cardId)
  );
}
