import type { CanvasCamera, CanvasPoint } from '@plugin/canvas/shared';

export function canvasConnectionLabelStyle(point: CanvasPoint | null, camera: CanvasCamera, viewport: { readonly width: number; readonly height: number }) {
  if (!point) return { display: 'none' };
  const width = Math.min(360, Math.max(0, viewport.width - 32));
  const left = Math.max(16, Math.min(viewport.width - width - 16, point.x * camera.zoom + camera.x - width / 2));
  const top = Math.max(16, Math.min(viewport.height - 120, point.y * camera.zoom + camera.y + 18));
  return { left: `${left}px`, top: `${top}px`, width: `${width}px`, maxHeight: `${Math.max(80, viewport.height - top - 16)}px` };
}
