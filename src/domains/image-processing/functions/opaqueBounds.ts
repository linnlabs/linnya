import type { PixelBox } from '../definitions/imageProcessing';

/**
 * 框内透明度不低于 `minAlpha` 的像素的紧边界；一个都没有时返回 null（例如网格切时的空格子）。
 * 宫格切图用 1（不丢任何可见像素）；去背用 8，遮罩在背景上的零星低透明度噪点不会把范围撑到整张图。
 */
export function opaqueBounds(rgba: Uint8Array, width: number, box: PixelBox, minAlpha: number): PixelBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  for (let y = box.top; y < box.top + box.height; y += 1) {
    for (let x = box.left; x < box.left + box.width; x += 1) {
      if (rgba[(y * width + x) * 4 + 3] < minAlpha) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < 0 ? null : { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
