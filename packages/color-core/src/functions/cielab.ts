import type { Cielab, RgbChannels } from '../definitions/color.js'
import { srgbChannelToLinear } from './colorSpace.js'

/**
 * sRGB → CIELAB（D65 白点，CIE 1976）。
 *
 * 只给需要和 CIE 1976 色差（ΔE76）阈值对齐的调用方用，例如去背按“与背景的色差”判像素。
 * 判断颜色关系、色相和对比度仍用 OKLab / OKLCH：在 OKLab 里彩度差的权重比 CIELAB 小得多，
 * 偏灰的器物和灰背景会被当成同一种颜色，按色差去背时主体会被挖空。
 */

/** sRGB（D65）→ XYZ 的矩阵，与 IEC 61966-2-1 一致。 */
const SRGB_TO_XYZ = [
  [0.4124, 0.3576, 0.1805],
  [0.2126, 0.7152, 0.0722],
  [0.0193, 0.1192, 0.9505],
] as const
/** D65 白点，Y 归一为 1。 */
const WHITE_X = 0.95047
const WHITE_Z = 1.08883
/** CIE 规定的分段点：(6/29)³ 以下用线性段，避免立方根在 0 附近的无穷斜率。 */
const EPSILON = 216 / 24389
const KAPPA = 24389 / 27

function labF(t: number): number {
  return t > EPSILON ? Math.cbrt(t) : (KAPPA * t + 16) / 116
}

export function rgbToCielab(rgb: RgbChannels): Cielab {
  const r = srgbChannelToLinear(rgb[0])
  const g = srgbChannelToLinear(rgb[1])
  const b = srgbChannelToLinear(rgb[2])
  const [xRow, yRow, zRow] = SRGB_TO_XYZ
  const x = labF((xRow[0] * r + xRow[1] * g + xRow[2] * b) / WHITE_X)
  const y = labF(yRow[0] * r + yRow[1] * g + yRow[2] * b)
  const z = labF((zRow[0] * r + zRow[1] * g + zRow[2] * b) / WHITE_Z)
  return { l: 116 * y - 16, a: 500 * (x - y), b: 200 * (y - z) }
}
