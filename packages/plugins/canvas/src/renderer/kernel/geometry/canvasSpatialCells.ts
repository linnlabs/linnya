import type { CanvasCardId, CanvasRectangle } from '../../../shared';
import type { CanvasSpatialCell, CanvasSpatialEntry } from '../definitions/canvasSpatialProjection';
import { intersectCanvasRegion, subtractCanvasCover } from './canvasVisibleRegions';

export const canvasSpatialCellSize = 512;
export function canvasSpatialCell(key: string, x: number, y: number): CanvasSpatialCell {
  return {
    key,
    bounds: {
      x: x * canvasSpatialCellSize,
      y: y * canvasSpatialCellSize,
      width: canvasSpatialCellSize,
      height: canvasSpatialCellSize,
    },
    entries: new Set(),
  };
}
export function canvasSpatialKeys(bounds: CanvasRectangle): readonly string[] | null {
  const left = Math.floor(bounds.x / canvasSpatialCellSize),
    right = Math.floor((bounds.x + bounds.width) / canvasSpatialCellSize);
  const top = Math.floor(bounds.y / canvasSpatialCellSize),
    bottom = Math.floor((bounds.y + bounds.height) / canvasSpatialCellSize);
  if ((right - left + 1) * (bottom - top + 1) > 64) return null;
  const result: string[] = [];
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) result.push(`${x}:${y}`);
  return result;
}
/** 从顶层逐次扣除纸面；已全部覆盖的格无需再扫描其下成千上万张卡。 */
export function projectCanvasSpatialCell(
  cell: CanvasSpatialCell,
  large: ReadonlySet<CanvasSpatialEntry>
): ReadonlyMap<CanvasCardId, readonly CanvasRectangle[]> {
  const entries = [...cell.entries, ...large]
    .filter(entry => intersectCanvasRegion(entry.bounds, cell.bounds))
    .sort((a, b) => b.rank - a.rank);
  const result = new Map<CanvasCardId, readonly CanvasRectangle[]>();
  let uncovered: readonly CanvasRectangle[] = [cell.bounds];
  for (const entry of entries) {
    const bounds = entry.bounds,
      visible = uncovered.flatMap(region => {
        const intersection = intersectCanvasRegion(region, bounds);
        return intersection ? [intersection] : [];
      });
    if (visible.length) result.set(entry.card.id, visible);
    if (!entry.opaque || bounds.width <= 12 || bounds.height <= 12) continue;
    // 阴影和圆角不遮挡正文，与静态投影使用同一个6px内接纸面合同。
    const cover = {
      x: bounds.x + 6,
      y: bounds.y + 6,
      width: bounds.width - 12,
      height: bounds.height - 12,
    };
    uncovered = subtractCanvasCover(uncovered, cover);
    if (!uncovered.length) break;
  }
  return result;
}
