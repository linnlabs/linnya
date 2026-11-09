import type { Oklch } from '../../definitions/color.js'
import { isHueWithinArc, normalizeHue } from '../../functions/hue.js'
import type { HueRange } from '../definitions/palette.js'
import {
  AVOID_HUE_RADIUS,
  CHROMATIC_MIN_CHROMA,
  EXCLUSION_MARGIN,
  NEUTRAL_MAX_CHROMA,
  OPPOSITE_HUE_FROM,
  OPPOSITE_HUE_TO,
} from '../definitions/paletteConstants.js'

/** 排除区：每种本色对侧 150°–210°，加上 `avoid` 颜色两侧各 30°；重叠的区间合并。 */
export function excludedHueRanges(subject: readonly Oklch[], avoid: readonly Oklch[]): HueRange[] {
  const ranges: HueRange[] = []
  for (const color of subject) {
    if (color.c < CHROMATIC_MIN_CHROMA) continue
    ranges.push([normalizeHue(color.h + OPPOSITE_HUE_FROM), normalizeHue(color.h + OPPOSITE_HUE_TO)])
  }
  for (const color of avoid) {
    if (color.c < NEUTRAL_MAX_CHROMA) continue
    ranges.push([normalizeHue(color.h - AVOID_HUE_RADIUS), normalizeHue(color.h + AVOID_HUE_RADIUS)])
  }
  return mergeHueRanges(ranges)
}

/** 按 1° 掩码合并重叠或相接的区间；整圈都被排除时返回 [0, 360]。 */
function mergeHueRanges(ranges: readonly HueRange[]): HueRange[] {
  if (ranges.length === 0) return []
  const covered = Array.from({ length: 360 }, (_, degree) => ranges.some(([from, to]) => isHueWithinArc(degree, from, to)))
  // 两段之间的空隙不比生成时的余量（两侧各 EXCLUSION_MARGIN）宽，就当作一段：反正用不上。
  const fillableGap = 2 * EXCLUSION_MARGIN
  for (let degree = 0; degree < 360; degree += 1) {
    if (covered[degree] || !covered[(degree + 359) % 360]) continue
    let length = 0
    while (length <= fillableGap && !covered[(degree + length) % 360]) length += 1
    if (length <= fillableGap && length < 360) for (let step = 0; step < length; step += 1) covered[(degree + step) % 360] = true
  }
  if (covered.every(Boolean)) return [[0, 360]]
  const start = covered.findIndex(value => !value)
  const merged: HueRange[] = []
  let runStart: number | null = null
  for (let step = 1; step <= 360; step += 1) {
    const degree = (start + step) % 360
    if (covered[degree] && runStart === null) runStart = degree
    if (!covered[degree] && runStart !== null) {
      merged.push([runStart, normalizeHue(degree - 1)])
      runStart = null
    }
  }
  // 区间端点取原始值，不按 1° 取整：找回落在每段里的原始端点。
  return merged.map(([from, to]) => {
    const originalFrom = ranges.map(range => range[0]).find(value => isHueWithinArc(value, normalizeHue(from - 1), from))
    const originalTo = ranges.map(range => range[1]).find(value => isHueWithinArc(value, to, normalizeHue(to + 1)))
    return [originalFrom ?? from, originalTo ?? to] as const
  })
}

/** 指定色优先：包含指定色相的排除段作废（两个指定色互为对侧、`avoid` 压到指定色等情况）。 */
export function withoutPinnedHues(ranges: readonly HueRange[], pinnedHues: readonly number[]): HueRange[] {
  return ranges.filter(([from, to]) => !pinnedHues.some(hue => isHueWithinArc(hue, from, to)))
}

export function isHueExcluded(hue: number, ranges: readonly HueRange[], margin = 0): boolean {
  return ranges.some(([from, to]) => isHueWithinArc(hue, from - margin, to + margin))
}

/** 是否需要受排除区约束：彩度很低的颜色看作中性。 */
export function isColorExcluded(color: Oklch, ranges: readonly HueRange[], margin = 0): boolean {
  return color.c >= NEUTRAL_MAX_CHROMA && isHueExcluded(color.h, ranges, margin)
}

/** 离 `hue` 最近、且距排除区至少 `margin` 的色相；移动超过 `maxShift` 时返回 null。 */
export function nearestAllowedHue(hue: number, ranges: readonly HueRange[], margin: number, maxShift: number): number | null {
  for (let shift = 0; shift <= maxShift; shift += 1) {
    for (const candidate of shift === 0 ? [hue] : [hue + shift, hue - shift]) {
      if (!isHueExcluded(candidate, ranges, margin)) return normalizeHue(candidate)
    }
  }
  return null
}
