import type { CanvasRectangle } from '../../../../shared';

/** 保留精确的可见片段边界，不能向外扩回整卡而重画已被纸面遮住的正文。 */
export function splitCardRasterRegions(regions: readonly CanvasRectangle[], scale: number, maxTextureEdge = 4096): readonly CanvasRectangle[] {
  const edge = Math.floor(maxTextureEdge / scale);
  if (!Number.isFinite(edge) || edge < 1) throw new Error('invalid_raster_scale');
  const result: CanvasRectangle[] = [];
  for (const region of regions) {
    for (let y = region.y; y < region.y + region.height; y += edge) for (let x = region.x; x < region.x + region.width; x += edge) {
      result.push({ x, y, width: Math.min(edge, region.x + region.width - x), height: Math.min(edge, region.y + region.height - y) });
    }
  }
  return result;
}
