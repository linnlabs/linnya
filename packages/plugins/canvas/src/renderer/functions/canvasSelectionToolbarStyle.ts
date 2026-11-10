import type { CanvasCamera, CanvasRectangle } from '@plugin/canvas/shared';
import type { CSSProperties } from 'vue';

interface ToolbarGeometry {
  readonly toolbarHeight?: number;
  readonly capsuleBottom?: number;
  /** 其他卡片的世界矩形；浮条尽量不压住它们。 */
  readonly obstacles?: readonly CanvasRectangle[];
}
const overlap = (a: CanvasRectangle, b: CanvasRectangle) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/**
 * 浮条默认在选区上方10屏幕px；贴近顶部胶囊，或上方压住其他卡片而下方压得更少时，整体翻到选区下方。
 * 默认尺寸来自28px工具条按钮与上下4px内边距。
 */
export function canvasSelectionToolbarStyle(
  bounds: CanvasRectangle | null,
  camera: CanvasCamera,
  viewportWidth: number,
  geometry: ToolbarGeometry = {}
): CSSProperties {
  if (!bounds) return { display: 'none' };
  const { toolbarHeight = 44, capsuleBottom = 56, obstacles = [] } = geometry;
  const above = bounds.y * camera.zoom + camera.y - toolbarHeight - 10;
  const below = (bounds.y + bounds.height) * camera.zoom + camera.y + 10;
  const halfWidth = Math.min(220, Math.max(0, viewportWidth - 24) / 2);
  const center = (bounds.x + bounds.width / 2) * camera.zoom + camera.x;
  const left = Math.min(Math.max(12 + halfWidth, center), viewportWidth - 12 - halfWidth);
  const covered = (top: number) => {
    const band = {
      x: left - halfWidth,
      y: top,
      width: halfWidth * 2,
      height: toolbarHeight,
    };
    return obstacles.reduce(
      (sum, card) =>
        sum +
        overlap(band, {
          x: card.x * camera.zoom + camera.x,
          y: card.y * camera.zoom + camera.y,
          width: card.width * camera.zoom,
          height: card.height * camera.zoom,
        }),
      0
    );
  };
  // 顶部胶囊与浮条至少间隔8px；冲突时整体翻到选区下方，不能钳进卡片。
  const capsuleConflict = above < capsuleBottom + 8;
  const coveredAbove = capsuleConflict ? Infinity : covered(above);
  const top = coveredAbove > 0 && covered(below) < coveredAbove ? below : above;
  return { left: `${left}px`, top: `${top}px` };
}
