import type { CanvasCamera, CanvasRectangle } from '@plugin/canvas/shared';
import type { CSSProperties } from 'vue';

export function cardEditorStyle(
  card: CanvasRectangle | undefined,
  camera: CanvasCamera
): CSSProperties {
  if (!card) return { display: 'none' };
  return {
    display: 'block',
    width: `${card.width}px`,
    height: `${card.height}px`,
    transform: `translate(${card.x * camera.zoom + camera.x}px, ${card.y * camera.zoom + camera.y}px) scale(${camera.zoom})`,
  };
}
