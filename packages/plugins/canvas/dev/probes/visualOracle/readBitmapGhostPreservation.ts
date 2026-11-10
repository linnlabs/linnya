import type { VisualImage } from './definitions';

/** ghost只验证既有正确body位图未被擦掉；DOM↔bitmap的排版/AA质量由文字oracle独立负责。 */
export function readBitmapGhostPreservation(source: VisualImage, target: VisualImage, input: { theme: 'light' | 'dark'; dpr: number; ghostY: number }) {
  if (source.width !== target.width || source.height !== target.height || source.rgba.length !== target.rgba.length) throw new Error('visual_ghost_image_size');
  const ink = (pixels: Uint8Array, i: number) => input.theme === 'light' ? pixels[i] < 180 && pixels[i + 1] < 180 && pixels[i + 2] < 180
    : pixels[i] > 150 && pixels[i + 1] > 150 && pixels[i + 2] > 150;
  let sourceInk = 0, retainedInk = 0;
  for (let y = 0; y < source.height; y++) {
    if (Math.abs(y / input.dpr - input.ghostY) >= 2) continue;
    for (let x = 0; x < source.width; x++) {
      const i = (y * source.width + x) * 4;
      if (ink(source.rgba, i)) { sourceInk++; if (ink(target.rgba, i)) retainedInk++; }
    }
  }
  const preservation = sourceInk ? retainedInk / sourceInk : 0;
  return { baseline: 'raster-body-bitmap', sourceInk, retainedInk, preservation, pass: sourceInk >= 10 && preservation >= 0.95 };
}
