import type { Oklab, Oklch } from '../../definitions/color.js'
import { deltaEOK, oklabToOklch, rgbToOklab } from '../../functions/colorSpace.js'
import { isHueWithinArc } from '../../functions/hue.js'
import { parseColor } from '../../functions/parseColor.js'
import type { Palette } from '../definitions/palette.js'
import {
  ACCENT_INK_MIN_DISTANCE,
  ACCENT_TOO_CLOSE_FACTOR,
  CHART_MIN_STEP_DISTANCE,
  CHART_SERIES_COUNT,
  CHART_TOO_CLOSE_FACTOR,
  DISLIKED_CHART_FACTOR,
  DISLIKED_HUES,
  DISLIKED_MAX_LIGHTNESS,
  DISLIKED_MIN_CHROMA,
  DISLIKED_ROLE_FACTOR,
  DISTANCE_WEIGHTS,
  LOUD_ACCENT_CHROMA,
  LOUD_BG_CHROMA,
  LOUD_FACTOR,
  STRUCTURE_DISTANCE,
} from '../definitions/paletteConstants.js'

/**
 * 候选配色的评分与彼此的感知距离。评分是显式规则的系数之积，不用学来的权重；
 * 距离是按角色加权的 ΔEOK 平均（底、点题、图表这些显眼的角色权重大），结构不同（底色明暗、关系、色调）再加一点。
 */

export interface PaletteColors {
  readonly bg: Oklab
  readonly surface: Oklab
  readonly ink: Oklab
  readonly muted: Oklab
  readonly accent: readonly Oklab[]
  /** 按 CHART_SERIES_COUNT 重采样，系列数不同的配色也能逐位比较。 */
  readonly chart: readonly Oklab[]
}

function labOf(hex: string): Oklab {
  const parsed = parseColor(hex)
  return parsed ? rgbToOklab(parsed.channels) : { l: 0, a: 0, b: 0 }
}

function resample(colors: readonly Oklab[], count: number): Oklab[] {
  if (colors.length === 0) return []
  return Array.from({ length: count }, (_, index) => {
    const position = count === 1 ? 0 : (index * (colors.length - 1)) / (count - 1)
    return colors[Math.round(position)] ?? colors[colors.length - 1] ?? { l: 0, a: 0, b: 0 }
  })
}

export function paletteColors(palette: Palette): PaletteColors {
  return {
    bg: labOf(palette.bg),
    surface: labOf(palette.surface),
    ink: labOf(palette.ink),
    muted: labOf(palette.muted),
    accent: palette.accent.map(labOf),
    chart: resample(palette.chart.map(labOf), CHART_SERIES_COUNT),
  }
}

function isDisliked(color: Oklch): boolean {
  return isHueWithinArc(color.h, DISLIKED_HUES.min, DISLIKED_HUES.max) && color.c > DISLIKED_MIN_CHROMA && color.l < DISLIKED_MAX_LIGHTNESS
}

/** 1 表示没有毛病；每条毛病乘一个系数。风格偏好只在采样频率里体现，不进分数，否则高分段会只剩几种风格。 */
export function scorePalette(palette: Palette, colors: PaletteColors): number {
  let score = 1
  const accent = colors.accent[0]
  for (const role of [colors.bg, colors.surface, ...colors.accent]) {
    if (isDisliked(oklabToOklch(role))) score *= DISLIKED_ROLE_FACTOR
  }
  const original = palette.chart.map(labOf)
  const dislikedShare = original.filter(color => isDisliked(oklabToOklch(color))).length / Math.max(1, original.length)
  score *= 1 - (1 - DISLIKED_CHART_FACTOR) * dislikedShare
  if (accent && deltaEOK(accent, colors.ink) < ACCENT_INK_MIN_DISTANCE) score *= ACCENT_TOO_CLOSE_FACTOR
  const steps = original.slice(1).map((color, index) => deltaEOK(color, original[index] ?? color))
  if (steps.some(step => step < CHART_MIN_STEP_DISTANCE)) score *= CHART_TOO_CLOSE_FACTOR
  if (accent && oklabToOklch(colors.bg).c >= LOUD_BG_CHROMA && oklabToOklch(accent).c >= LOUD_ACCENT_CHROMA) score *= LOUD_FACTOR
  return score
}

function weightedDistance(left: PaletteColors, right: PaletteColors): number {
  const parts: (readonly [number, number])[] = [
    [DISTANCE_WEIGHTS.bg, deltaEOK(left.bg, right.bg)],
    [DISTANCE_WEIGHTS.surface, deltaEOK(left.surface, right.surface)],
    [DISTANCE_WEIGHTS.ink, deltaEOK(left.ink, right.ink)],
    [DISTANCE_WEIGHTS.muted, deltaEOK(left.muted, right.muted)],
  ]
  const leftAccent = left.accent[0]
  const rightAccent = right.accent[0]
  if (leftAccent && rightAccent) parts.push([DISTANCE_WEIGHTS.accent, deltaEOK(leftAccent, rightAccent)])
  const chartCount = Math.min(left.chart.length, right.chart.length)
  for (let index = 0; index < chartCount; index += 1) {
    const a = left.chart[index]
    const b = right.chart[index]
    if (a && b) parts.push([DISTANCE_WEIGHTS.chart / chartCount, deltaEOK(a, b)])
  }
  const totalWeight = parts.reduce((sum, [weight]) => sum + weight, 0)
  return parts.reduce((sum, [weight, distance]) => sum + weight * distance, 0) / totalWeight
}

/** 两套配色的感知距离：角色加权 ΔEOK，加上结构差异。 */
export function paletteDistance(left: Palette, right: Palette, leftColors = paletteColors(left), rightColors = paletteColors(right)): number {
  let distance = weightedDistance(leftColors, rightColors)
  if (left.base !== right.base) distance += STRUCTURE_DISTANCE.base
  if (left.relation !== right.relation) distance += STRUCTURE_DISTANCE.relation
  if (left.tone !== right.tone) distance += STRUCTURE_DISTANCE.tone
  return distance
}
