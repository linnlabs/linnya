import type { CanvasCamera, CanvasPoint } from '@plugin/canvas/shared';

export function canvasConnectionLabelStyle(
  point: CanvasPoint | null,
  camera: CanvasCamera,
  viewport: { readonly width: number; readonly height: number }
) {
  if (!point) return { display: 'none' };
  // 面板宽度随全文收缩，最多360px；以标签中点居中，靠边时整体内收。
  const width = Math.min(360, Math.max(0, viewport.width - 32));
  const center = Math.max(
    16 + width / 2,
    Math.min(viewport.width - width / 2 - 16, point.x * camera.zoom + camera.x)
  );
  const top = Math.max(16, Math.min(viewport.height - 120, point.y * camera.zoom + camera.y + 18));
  return {
    left: `${center}px`,
    top: `${top}px`,
    maxWidth: `${width}px`,
    transform: 'translateX(-50%)',
    maxHeight: `${Math.max(80, viewport.height - top - 16)}px`,
  };
}
