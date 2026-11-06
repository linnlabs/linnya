import type { CanvasCard, CanvasElement } from '@plugin/canvas/shared';

/** Alt复制也沿用鼠标下的视觉起点；正文、修订和引用仍取最新正式子图。 */
export function canvasDraggedCopySource(
  elements: readonly CanvasElement[],
  positions: readonly Pick<CanvasCard, 'id' | 'x' | 'y'>[],
  dx: number,
  dy: number
): readonly CanvasElement[] {
  const byId = new Map(positions.map(position => [position.id, position]));
  return elements.map(element => {
    if (element.type === 'edge') return element;
    const point = byId.get(element.id);
    return point ? { ...element, x: point.x - dx, y: point.y - dy } : element;
  });
}
