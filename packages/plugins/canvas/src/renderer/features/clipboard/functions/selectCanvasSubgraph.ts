import type { CanvasCardId, CanvasElement } from '@plugin/canvas/shared';
export function selectCanvasSubgraph(
  elements: readonly CanvasElement[],
  ids: readonly CanvasCardId[]
): CanvasElement[] {
  // 复制分区连同区内的卡一起复制。
  const sections = new Set(
    elements.flatMap(element =>
      element.type === 'section' && ids.includes(element.id) ? [element.id] : []
    )
  );
  if (sections.size)
    ids = [
      ...ids,
      ...elements.flatMap(element =>
        element.type !== 'edge' && element.parentId && sections.has(element.parentId)
          ? [element.id]
          : []
      ),
    ];
  return elements.filter(element =>
    element.type !== 'edge'
      ? ids.includes(element.id)
      : element.from.kind === 'card' &&
        element.to.kind === 'card' &&
        ids.includes(element.from.cardId) &&
        ids.includes(element.to.cardId)
  );
}
