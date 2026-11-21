import type { CanvasRectangle } from '../../../shared';

export function intersectCanvasRegion(
  a: CanvasRectangle,
  b: CanvasRectangle
): CanvasRectangle | null {
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y),
    right = Math.min(a.x + a.width, b.x + b.width),
    bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}
/** 四条不相交的剩余条块；输入输出均为世界矩形，不引入分辨率误差。 */
export function subtractCanvasRegion(
  source: CanvasRectangle,
  cover: CanvasRectangle
): readonly CanvasRectangle[] {
  const overlap = intersectCanvasRegion(source, cover);
  if (!overlap) return [source];
  return splitCanvasIntersection(source, overlap);
}
function splitCanvasIntersection(
  source: CanvasRectangle,
  overlap: CanvasRectangle
): CanvasRectangle[] {
  const result: CanvasRectangle[] = [];
  if (overlap.y > source.y)
    result.push({ x: source.x, y: source.y, width: source.width, height: overlap.y - source.y });
  if (overlap.y + overlap.height < source.y + source.height)
    result.push({
      x: source.x,
      y: overlap.y + overlap.height,
      width: source.width,
      height: source.y + source.height - overlap.y - overlap.height,
    });
  if (overlap.x > source.x)
    result.push({ x: source.x, y: overlap.y, width: overlap.x - source.x, height: overlap.height });
  if (overlap.x + overlap.width < source.x + source.width)
    result.push({
      x: overlap.x + overlap.width,
      y: overlap.y,
      width: source.x + source.width - overlap.x - overlap.width,
      height: overlap.height,
    });
  return result;
}
/** 无交集不生成临时数组；密集卡片的遮挡证明常反复检查同一批剩余边角。 */
export function subtractCanvasCover(
  regions: readonly CanvasRectangle[],
  cover: CanvasRectangle
): readonly CanvasRectangle[] {
  let result: CanvasRectangle[] | undefined;
  for (let index = 0; index < regions.length; index++) {
    const region = regions[index],
      overlap = intersectCanvasRegion(region, cover);
    if (!overlap) {
      result?.push(region);
      continue;
    }
    result ??= regions.slice(0, index);
    result.push(...splitCanvasIntersection(region, overlap));
  }
  return result ?? regions;
}
export function subtractCanvasRegions(
  regions: readonly CanvasRectangle[],
  covers: readonly CanvasRectangle[]
): readonly CanvasRectangle[] {
  let result = regions;
  for (const cover of covers) {
    result = subtractCanvasCover(result, cover);
    if (!result.length) break;
  }
  return result;
}
