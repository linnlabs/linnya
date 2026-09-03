/**
 * Konva 光栅化缩放上限
 *
 * 超过此值后，额外的放大由 CSS transform 完成（GPU 合成，零开销）。
 * 防止高缩放级别下 Canvas 像素缓冲区过大导致渲染帧率骤降。
 * 上限取 devicePixelRatio（保证 100% 缩放下逐物理像素清晰），至多 2。
 */
export function resolveKonvaMaxRasterScale(devicePixelRatio: number | undefined): number {
  return Math.min(devicePixelRatio ?? 2, 2);
}

export function clampKonvaRasterScale(scale: number, maxRasterScale: number): number {
  return Math.min(scale, maxRasterScale);
}
