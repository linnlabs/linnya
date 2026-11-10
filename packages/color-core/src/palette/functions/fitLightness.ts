import type { Oklch, RgbChannels } from '../../definitions/color.js'
import { oklchToRgb } from '../../functions/colorSpace.js'
import { contrastRatio } from '../../functions/contrast.js'
import { parseColor, toHex } from '../../functions/parseColor.js'

/**
 * 保持色相与彩度，只沿明度找到对 `against` 达到 `minContrast` 的颜色：期望明度已经够就用它，
 * 否则二分找到离期望最近的达标明度（Leonardo 的做法）。色域按只降彩度的方式映射，色相不变。
 * 按最终取整后的 hex 复核；朝 `direction` 走到头仍不达标时返回 null。
 */

const SEARCH_STEPS = 28
const ROUNDING_NUDGE = 0.002
const MAX_ROUNDING_NUDGES = 12

export function oklchHex(color: Oklch): string {
  return toHex(oklchToRgb(color, { jnd: 0 }))
}

function contrastOf(color: Oklch, against: RgbChannels): number {
  const parsed = parseColor(oklchHex(color))
  return parsed ? contrastRatio(parsed.channels, against) : 1
}

export function fitLightness(
  color: Oklch,
  against: RgbChannels,
  minContrast: number,
  direction: 'darker' | 'lighter',
): Oklch | null {
  if (contrastOf(color, against) >= minContrast) return color
  const extreme = direction === 'darker' ? 0 : 1
  if (contrastOf({ ...color, l: extreme }, against) < minContrast) return null
  let failing = color.l
  let passing = extreme
  for (let step = 0; step < SEARCH_STEPS; step += 1) {
    const middle = (failing + passing) / 2
    if (contrastOf({ ...color, l: middle }, against) >= minContrast) passing = middle
    else failing = middle
  }
  let fitted: Oklch = { ...color, l: passing }
  for (let nudge = 0; nudge < MAX_ROUNDING_NUDGES && contrastOf(fitted, against) < minContrast; nudge += 1) {
    fitted = { ...fitted, l: fitted.l + (direction === 'darker' ? -ROUNDING_NUDGE : ROUNDING_NUDGE) }
  }
  return contrastOf(fitted, against) >= minContrast ? fitted : null
}
