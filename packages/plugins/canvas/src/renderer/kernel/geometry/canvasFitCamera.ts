import { canvasBounds, type CanvasCamera, type CanvasRectangle } from '../../../shared';

export function canvasFitCamera(rectangles: readonly CanvasRectangle[], viewport: { readonly width: number; readonly height: number }): CanvasCamera | null {
  const bounds = canvasBounds(rectangles);
  if (!bounds) return null;
  const zoom = Math.max(0.02, Math.min(1, (viewport.width - 80) / Math.max(1, bounds.width), (viewport.height - 80) / Math.max(1, bounds.height)));
  return { zoom, x: (viewport.width - bounds.width * zoom) / 2 - bounds.x * zoom, y: (viewport.height - bounds.height * zoom) / 2 - bounds.y * zoom };
}
