/**
 * AestheticLint 的颜色工具。
 *
 * 解析、色彩空间、相对亮度与对比度来自 `@linnya/color-core`，这里只保留 lint 输入需要的容错
 * （无 `#`、带透明度的 hex）和“算不算有颜色”的判断。色相与色差都用 OKLCH / ΔEOK。
 *
 * 所有解析函数对非法输入返回 `null`，不抛错。
 */

import {
  contrastRatio,
  deltaEOK,
  parseColor,
  relativeLuminance as relativeLuminanceOfChannels,
  rgbToOklab,
  rgbToOklch,
  type Oklch,
  type RgbChannels,
} from '@linnya/color-core';
import { VISIBLE_HUE_MIN_CHROMA } from '@plugin/slides/shared/designDirection';

export interface RgbColor {
  r: number; // 0-255
  g: number; // 0-255
  b: number; // 0-255
}

/**
 * 解析 hex 字符串为 RGB。支持：
 * - `#RGB`、`#RRGGBB`
 * - `RGB`、`RRGGBB`（无 #）
 * - 大小写不敏感、首尾空白容错
 * - `#RRGGBBAA` / `#RGBA`：忽略 alpha 通道，仅用前 6/3 位
 *
 * 失败返回 null。
 */
export function parseHex(input: string | undefined | null): RgbColor | null {
  if (typeof input !== 'string') return null;
  const digits = input.trim().replace(/^#/, '');
  const opaque = digits.length === 4 ? digits.slice(0, 3) : digits.length === 8 ? digits.slice(0, 6) : digits;
  const parsed = parseColor(`#${opaque}`);
  if (!parsed) return null;
  const [r, g, b] = parsed.channels;
  return { r, g, b };
}

export function toOklch(rgb: RgbColor): Oklch {
  return rgbToOklch(toChannels(rgb));
}

/** 中性色不参与色相统计：彩度太低，页面上看不出色相。近黑、近白的彩度本来就低，不另设明度条件。 */
export function isNeutralColor(color: Oklch): boolean {
  return color.c < VISIBLE_HUE_MIN_CHROMA;
}

/** 两个颜色的 ΔEOK（OKLab 欧氏距离，明度 0-1 的尺度）。 */
export function colorDistance(left: RgbColor, right: RgbColor): number {
  return deltaEOK(rgbToOklab(toChannels(left)), rgbToOklab(toChannels(right)));
}

/** WCAG 2.x 相对亮度，0-1。 */
export function relativeLuminance(rgb: RgbColor): number {
  return relativeLuminanceOfChannels(toChannels(rgb));
}

/** WCAG 对比度，1.0（同色）— 21.0（纯黑/纯白）。 */
export function wcagContrastRatio(c1: RgbColor, c2: RgbColor): number {
  return contrastRatio(toChannels(c1), toChannels(c2));
}

/**
 * 圆形（角度）方差的 stddev，单位：度。用于跨页主色 hue 漂移检测。
 *
 * 算法：把每个角度映射到单位圆 (cos, sin)，求平均向量长度 R ∈ [0,1]，
 * stddev = sqrt(-2 * ln(R)) * (180 / PI)。
 *
 * - R = 1（所有角度同向）→ stddev = 0
 * - R → 0（角度均匀分布）→ stddev → ∞
 *
 * 返回值上限截断在 180°（因为 hue 是周期 360°，180° 已经是最大可能离散）。
 * 输入空数组或单元素返回 0。
 */
export function circularStdDeviationDeg(huesDeg: number[]): number {
  if (huesDeg.length < 2) return 0;
  let sumCos = 0;
  let sumSin = 0;
  for (const h of huesDeg) {
    const rad = (h * Math.PI) / 180;
    sumCos += Math.cos(rad);
    sumSin += Math.sin(rad);
  }
  const meanCos = sumCos / huesDeg.length;
  const meanSin = sumSin / huesDeg.length;
  const r = Math.sqrt(meanCos * meanCos + meanSin * meanSin);
  if (r >= 1 - 1e-9) return 0;
  if (r <= 1e-9) return 180;
  const stddevRad = Math.sqrt(-2 * Math.log(r));
  const stddevDeg = (stddevRad * 180) / Math.PI;
  return Math.min(180, stddevDeg);
}

/** hue 的圆形平均值，返回 [0, 360)；空输入返回 0。 */
export function circularMeanDeg(huesDeg: number[]): number {
  if (huesDeg.length === 0) return 0;
  let sumCos = 0;
  let sumSin = 0;
  for (const hue of huesDeg) {
    const radians = (hue * Math.PI) / 180;
    sumCos += Math.cos(radians);
    sumSin += Math.sin(radians);
  }
  const degrees = (Math.atan2(sumSin, sumCos) * 180) / Math.PI;
  return degrees < 0 ? degrees + 360 : degrees;
}

function toChannels(rgb: RgbColor): RgbChannels {
  return [rgb.r, rgb.g, rgb.b];
}
