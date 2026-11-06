import type { CanvasCamera, CanvasPoint, CanvasRectangle } from '../definitions/canvasGeometry';

export function canvasRectanglesOverlap(a: CanvasRectangle, b: CanvasRectangle, gap = 0): boolean {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}

export function canvasScreenToWorld(point: CanvasPoint, camera: CanvasCamera): CanvasPoint {
  return { x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom };
}

export function canvasWorldToScreen(point: CanvasPoint, camera: CanvasCamera): CanvasPoint {
  return { x: point.x * camera.zoom + camera.x, y: point.y * camera.zoom + camera.y };
}

export function canvasBounds(rectangles: readonly CanvasRectangle[]): CanvasRectangle | null {
  if (rectangles.length === 0) return null;
  const x = Math.min(...rectangles.map(r => r.x));
  const y = Math.min(...rectangles.map(r => r.y));
  return {
    x,
    y,
    width: Math.max(...rectangles.map(r => r.x + r.width)) - x,
    height: Math.max(...rectangles.map(r => r.y + r.height)) - y,
  };
}
