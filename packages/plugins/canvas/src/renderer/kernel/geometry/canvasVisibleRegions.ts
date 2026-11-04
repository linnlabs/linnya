import type { CanvasCard, CanvasCardId, CanvasRectangle } from '../../../shared';

export function intersectCanvasRegion(a: CanvasRectangle, b: CanvasRectangle): CanvasRectangle | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y), right = Math.min(a.x + a.width, b.x + b.width), bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}
/** 四条不相交的剩余条块；输入输出均为世界矩形，不引入分辨率误差。 */
export function subtractCanvasRegion(source: CanvasRectangle, cover: CanvasRectangle): readonly CanvasRectangle[] {
  const overlap = intersectCanvasRegion(source, cover);
  if (!overlap) return [source];
  return splitCanvasIntersection(source, overlap);
}
function splitCanvasIntersection(source: CanvasRectangle, overlap: CanvasRectangle): CanvasRectangle[] {
  const result: CanvasRectangle[] = [];
  if (overlap.y > source.y) result.push({ x: source.x, y: source.y, width: source.width, height: overlap.y - source.y });
  if (overlap.y + overlap.height < source.y + source.height) result.push({ x: source.x, y: overlap.y + overlap.height, width: source.width, height: source.y + source.height - overlap.y - overlap.height });
  if (overlap.x > source.x) result.push({ x: source.x, y: overlap.y, width: overlap.x - source.x, height: overlap.height });
  if (overlap.x + overlap.width < source.x + source.width) result.push({ x: overlap.x + overlap.width, y: overlap.y, width: source.x + source.width - overlap.x - overlap.width, height: overlap.height });
  return result;
}
/** 无交集不生成临时数组；密集卡片的遮挡证明常反复检查同一批剩余边角。 */
export function subtractCanvasCover(regions: readonly CanvasRectangle[], cover: CanvasRectangle): readonly CanvasRectangle[] {
  let result: CanvasRectangle[] | undefined;
  for (let index = 0; index < regions.length; index++) {
    const region = regions[index], overlap = intersectCanvasRegion(region, cover);
    if (!overlap) { result?.push(region); continue; }
    result ??= regions.slice(0, index);
    result.push(...splitCanvasIntersection(region, overlap));
  }
  return result ?? regions;
}
export function subtractCanvasRegions(regions: readonly CanvasRectangle[], covers: readonly CanvasRectangle[]): readonly CanvasRectangle[] {
  let result = regions;
  for (const cover of covers) {
    result = subtractCanvasCover(result, cover);
    if (!result.length) break;
  }
  return result;
}

/** 文档位置/层级变化时建立世界可见片段；相机变化只裁视口，不重做矩形差。 */
export function createCanvasVisibleRegionProjection(cards: readonly CanvasCard[]): ReadonlyMap<CanvasCardId, readonly CanvasRectangle[]> {
  const cellSize = 512;
  const cells = new Map<string, CanvasRectangle[]>(), large: CanvasRectangle[] = [];
  const result = new Map<CanvasCardId, readonly CanvasRectangle[]>();
  const cellRange = (rectangle: CanvasRectangle) => ({ left: Math.floor(rectangle.x / cellSize), top: Math.floor(rectangle.y / cellSize),
    right: Math.floor((rectangle.x + rectangle.width) / cellSize), bottom: Math.floor((rectangle.y + rectangle.height) / cellSize) });
  for (let i = cards.length - 1; i >= 0; i--) {
    const card = cards[i], range = cellRange(card);
    const candidates = new Set<CanvasRectangle>(large);
    const cellCount = (range.right - range.left + 1) * (range.bottom - range.top + 1);
    // 五万字长卡跨越很多格，改查已有覆盖事实，不能为全文建立几千个空格。
    if (cellCount > 64) for (const covers of cells.values()) for (const cover of covers) candidates.add(cover);
    else for (let y = range.top; y <= range.bottom; y++) for (let x = range.left; x <= range.right; x++) {
      for (const cover of cells.get(`${x}:${y}`) ?? []) candidates.add(cover);
    }
    result.set(card.id, subtractCanvasRegions([{ x: card.x, y: card.y, width: card.width, height: card.height }], [...candidates]));
    // 阴影和圆角不视作实体遮挡；只扣内接纸面，保留边角的真实可见内容。
    if (card.width <= 12 || card.height <= 12) continue;
    const cover = { x: card.x + 6, y: card.y + 6, width: card.width - 12, height: card.height - 12 };
    if (cellCount > 64) { large.push(cover); continue; }
    for (let y = range.top; y <= range.bottom; y++) for (let x = range.left; x <= range.right; x++) {
      const key = `${x}:${y}`, values = cells.get(key) ?? []; values.push(cover); cells.set(key, values);
    }
  }
  return result;
}
