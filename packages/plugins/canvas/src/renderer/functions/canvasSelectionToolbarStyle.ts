import type { CanvasCamera, CanvasRectangle } from '@plugin/canvas/shared';
import type { CSSProperties } from 'vue';

/** 默认尺寸来自36px下拉触发器、上下4px内边距和顶部12px；宿主实测尺寸可覆盖。 */
export function canvasSelectionToolbarStyle(
  bounds: CanvasRectangle | null,
  camera: CanvasCamera,
  viewportWidth: number,
  geometry: { readonly toolbarHeight: number; readonly capsuleBottom: number } = {
    toolbarHeight: 44,
    capsuleBottom: 56,
  }
): CSSProperties {
  if (!bounds) return { display: 'none' };
  const above = bounds.y * camera.zoom + camera.y - geometry.toolbarHeight - 10;
  // 顶部胶囊与浮条至少间隔8px；冲突时整体翻到选区下方，不能钳进卡片。
  const top =
    above < geometry.capsuleBottom + 8
      ? (bounds.y + bounds.height) * camera.zoom + camera.y + 10
      : above;
  const halfWidth = Math.min(220, Math.max(0, viewportWidth - 24) / 2);
  const center = (bounds.x + bounds.width / 2) * camera.zoom + camera.x;
  return {
    left: `${Math.min(Math.max(12 + halfWidth, center), viewportWidth - 12 - halfWidth)}px`,
    top: `${top}px`,
  };
}
