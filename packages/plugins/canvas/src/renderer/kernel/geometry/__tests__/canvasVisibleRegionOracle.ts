import type { CanvasCard, CanvasCardId, CanvasRectangle } from '../../../../shared';
import { subtractCanvasRegions } from '../canvasVisibleRegions';

/** 测试参照：自上而下逐卡做矩形差得到可见片段，用来对照 CanvasSpatialProjection 的空间索引结果；生产代码不调用。 */
export function createCanvasVisibleRegionProjection(
  cards: readonly CanvasCard[]
): ReadonlyMap<CanvasCardId, readonly CanvasRectangle[]> {
  const cellSize = 512;
  const cells = new Map<string, CanvasRectangle[]>(),
    large: CanvasRectangle[] = [];
  const result = new Map<CanvasCardId, readonly CanvasRectangle[]>();
  const cellRange = (rectangle: CanvasRectangle) => ({
    left: Math.floor(rectangle.x / cellSize),
    top: Math.floor(rectangle.y / cellSize),
    right: Math.floor((rectangle.x + rectangle.width) / cellSize),
    bottom: Math.floor((rectangle.y + rectangle.height) / cellSize),
  });
  for (let i = cards.length - 1; i >= 0; i--) {
    const card = cards[i],
      range = cellRange(card);
    const candidates = new Set<CanvasRectangle>(large);
    const cellCount = (range.right - range.left + 1) * (range.bottom - range.top + 1);
    // 五万字长卡跨越很多格，改查已有覆盖事实，不能为全文建立几千个空格。
    if (cellCount > 64)
      for (const covers of cells.values()) for (const cover of covers) candidates.add(cover);
    else
      for (let y = range.top; y <= range.bottom; y++)
        for (let x = range.left; x <= range.right; x++) {
          for (const cover of cells.get(`${x}:${y}`) ?? []) candidates.add(cover);
        }
    result.set(
      card.id,
      subtractCanvasRegions(
        [{ x: card.x, y: card.y, width: card.width, height: card.height }],
        [...candidates]
      )
    );
    // 阴影和圆角不视作实体遮挡；只扣内接纸面，保留边角的真实可见内容。
    if (card.width <= 12 || card.height <= 12) continue;
    const cover = {
      x: card.x + 6,
      y: card.y + 6,
      width: card.width - 12,
      height: card.height - 12,
    };
    if (cellCount > 64) {
      large.push(cover);
      continue;
    }
    for (let y = range.top; y <= range.bottom; y++)
      for (let x = range.left; x <= range.right; x++) {
        const key = `${x}:${y}`,
          values = cells.get(key) ?? [];
        values.push(cover);
        cells.set(key, values);
      }
  }
  return result;
}
