import { canvasBounds, type CanvasElement, type CanvasPoint } from '@plugin/canvas/shared';
export function canvasPasteOffset(elements: readonly CanvasElement[], point: CanvasPoint): CanvasPoint {
  const bounds = canvasBounds(elements.filter(element => element.type !== 'edge'));
  return bounds ? { x: point.x - bounds.x - bounds.width / 2, y: point.y - bounds.y - bounds.height / 2 } : { x: 0, y: 0 };
}
