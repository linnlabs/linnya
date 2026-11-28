import type { RgbColor } from '../definitions/imageProcessing';

/** 边框亮度中位数低于它时不算浅底：拓片、书法、白描的纸色实测都在 200 以上，留出泛黄旧纸的余量。 */
export const LIGHT_BACKGROUND_MIN_LUMA = 170;

/** 比纸色略暗一点也算纸：吸收纸纹和 JPEG 噪声，否则纸面留下一层淡淡的杂色。 */
const PAPER_MARGIN = 0.92;
/** 最暗的 1% 当作满墨，不用绝对的 0：拓片和旧墨很少是纯黑。 */
const DARKEST_PERCENTILE = 0.01;

/** 取 2px 边框的亮度中位数，判断是不是白纸或浅底。 */
export function borderMedianLuma(gray: Uint8Array, width: number, height: number): number {
  const values: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) values.push(gray[y * width + x]);
    }
  }
  values.sort((a, b) => a - b);
  return values[values.length >> 1];
}

function darkestPercentile(gray: Uint8Array): number {
  const histogram = new Uint32Array(256);
  for (const value of gray) histogram[value] += 1;
  const target = gray.length * DARKEST_PERCENTILE;
  let seen = 0;
  for (let value = 0; value < 256; value += 1) {
    seen += histogram[value];
    if (seen >= target) return value;
  }
  return 0;
}

/**
 * 白底墨迹转成单色加透明度：纸色全透明，最暗处全不透明，中间按亮度线性过渡，颜色统一成墨色。
 * 纸色用实测的边框亮度，不用全图分位数：拓片大半是墨，按分位数拉伸会把字口的纸当成半透明的墨。
 */
export function grayToInk(gray: Uint8Array, paperLuma: number, ink: RgbColor): Uint8Array {
  const paper = paperLuma * PAPER_MARGIN;
  const darkest = Math.min(darkestPercentile(gray), paper - 1);
  const out = new Uint8Array(gray.length * 4);
  for (let i = 0; i < gray.length; i += 1) {
    const o = i * 4;
    out[o] = ink[0];
    out[o + 1] = ink[1];
    out[o + 2] = ink[2];
    out[o + 3] = Math.round(Math.min(1, Math.max(0, (paper - gray[i]) / (paper - darkest))) * 255);
  }
  return out;
}
