import type { CanvasCamera, CanvasPoint } from '../../../../shared';
export function canvasPanCamera(camera: CanvasCamera, dx: number, dy: number): CanvasCamera {
  return { ...camera, x: camera.x + dx, y: camera.y + dy };
}
export function canvasZoomCamera(
  camera: CanvasCamera,
  screen: CanvasPoint,
  deltaY: number
): CanvasCamera {
  const world = { x: (screen.x - camera.x) / camera.zoom, y: (screen.y - camera.y) / camera.zoom };
  const zoom = Math.min(4, Math.max(0.02, camera.zoom * Math.exp(-deltaY * 0.006)));
  return { zoom, x: screen.x - world.x * zoom, y: screen.y - world.y * zoom };
}
