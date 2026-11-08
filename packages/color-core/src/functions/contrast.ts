import type { RgbChannels } from '../definitions/color.js'
import { srgbChannelToLinear } from './colorSpace.js'

/** WCAG 2.x 相对亮度，0–1。 */
export function relativeLuminance(rgb: RgbChannels): number {
  return 0.2126 * srgbChannelToLinear(rgb[0]) + 0.7152 * srgbChannelToLinear(rgb[1]) + 0.0722 * srgbChannelToLinear(rgb[2])
}

/** WCAG 2.x 对比度，1–21；与参数顺序无关。 */
export function contrastRatio(left: RgbChannels, right: RgbChannels): number {
  const a = relativeLuminance(left)
  const b = relativeLuminance(right)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
