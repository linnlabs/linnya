/** 与既有身份牌/标题边界像素门共用同一二值墨迹口径；不为新排布场景放宽阈值。 */
export const canvasTitleInkMinimumIou = 0.995;
export function compareCanvasTitleInk(actual: Uint8Array, reference: Uint8Array, mode: 'alpha' | 'ink') {
  if (actual.length !== reference.length) throw new Error('title_boundary_capture_size_mismatch');
  const ink = (pixels: Uint8Array, at: number) => pixels[at + 3] > 16
    && (mode === 'alpha' || (pixels[at] < 150 && pixels[at + 1] < 150 && pixels[at + 2] < 150));
  let intersection = 0, union = 0;
  for (let i = 0; i < actual.length; i += 4) {
    const x = ink(actual, i), y = ink(reference, i);
    if (x && y) intersection++; if (x || y) union++;
  }
  return { intersection, union, iou: intersection / union };
}
