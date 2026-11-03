import { resolveVisibleCardTiles } from './resolveVisibleCardTiles';

/** 两轴均裁到可见纹理网格；高 DPR 宽卡也不能生成超长边纹理。 */
export function resolveVisibleCardRegions(input: {
  readonly cardX: number;
  readonly cardY: number;
  readonly cardWidth: number;
  readonly cardHeight: number;
  readonly worldLeft: number;
  readonly worldTop: number;
  readonly worldRight: number;
  readonly worldBottom: number;
  readonly scale: number;
  readonly maxTextureEdge?: number;
}) {
  const columns = resolveVisibleCardTiles({ cardY: input.cardX, cardHeight: input.cardWidth,
    worldTop: input.worldLeft, worldBottom: input.worldRight, scale: input.scale, maxTextureEdge: input.maxTextureEdge });
  const rows = resolveVisibleCardTiles(input);
  return rows.flatMap((row) => columns.map((column) => ({
    offsetX: column.offsetY, offsetY: row.offsetY, width: column.height, height: row.height,
  })));
}
