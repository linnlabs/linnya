/** 可见框按物理纹理上限切片，不把全文高度当成位图高度。 */
export function resolveVisibleCardTiles(input: {
  readonly cardY: number;
  readonly cardHeight: number;
  readonly worldTop: number;
  readonly worldBottom: number;
  readonly scale: number;
  readonly maxTextureEdge?: number;
}): readonly { readonly offsetY: number; readonly height: number }[] {
  const tileHeight = Math.floor((input.maxTextureEdge ?? 4096) / input.scale);
  if (!Number.isFinite(tileHeight) || tileHeight < 1) throw new Error('invalid_raster_scale');
  const start = Math.max(0, Math.floor((input.worldTop - input.cardY) / tileHeight) * tileHeight);
  const end = Math.min(input.cardHeight, input.worldBottom - input.cardY);
  const tiles: { offsetY: number; height: number }[] = [];
  for (let offsetY = start; offsetY < end; offsetY += tileHeight)
    tiles.push({ offsetY, height: Math.min(tileHeight, input.cardHeight - offsetY) });
  return tiles;
}
