import type { CanvasCardId, CanvasElement, CanvasElementId } from '@plugin/canvas/shared';

export function canvasFocusCardIds(elements: readonly CanvasElement[], ids: readonly CanvasElementId[]): readonly CanvasCardId[] {
  const selected = new Set(ids), cards = new Set<CanvasCardId>();
  for (const element of elements) {
    if (!selected.has(element.id)) continue;
    if (element.type !== 'edge') cards.add(element.id);
    else for (const endpoint of [element.from, element.to]) if (endpoint.kind === 'card') cards.add(endpoint.cardId);
  }
  return [...cards];
}
