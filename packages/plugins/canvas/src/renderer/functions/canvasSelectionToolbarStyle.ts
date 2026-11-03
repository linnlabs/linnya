import type { CanvasCamera, CanvasRectangle } from '@plugin/canvas/shared';
import type { CSSProperties } from 'vue';
export function canvasSelectionToolbarStyle(bounds: CanvasRectangle | null, camera: CanvasCamera, viewportWidth: number): CSSProperties {
  if (!bounds) return { display: 'none' };
  return { left: `${Math.min(Math.max(220, (bounds.x + bounds.width / 2) * camera.zoom + camera.x), Math.max(220, viewportWidth - 220))}px`,
    top: `${Math.max(64, bounds.y * camera.zoom + camera.y - 48)}px` };
}
