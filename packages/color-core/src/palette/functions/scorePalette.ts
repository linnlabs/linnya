import type { Oklab, Oklch } from '../../definitions/color.js'
import { deltaEOK, oklabToOklch, rgbToOklab } from '../../functions/colorSpace.js'
import { isHueWithinArc } from '../../functions/hue.js'
import { parseColor } from '../../functions/parseColor.js'
import { colorFamily } from '../definitions/hueNames.js'
import type { Palette } from '../definitions/palette.js'
import {
  ACCENT_INK_MIN_DISTANCE,
  ACCENT_TOO_CLOSE_FACTOR,
  BASE_DISTANCE,
  CHART_MIN_STEP_DISTANCE,
  CHART_SERIES_COUNT,
  CHART_TOO_CLOSE_FACTOR,
  COLOR_DISTANCE_WEIGHT,
  DISLIKED_CHART_FACTOR,
  DISLIKED_HUES,
  DISLIKED_MAX_LIGHTNESS,
  DISLIKED_MIN_CHROMA,
  DISLIKED_ROLE_FACTOR,
  DISTANCE_WEIGHTS,
  FAMILY_DISTANCE_WEIGHT,
  FAMILY_MIN_CHROMA,
  LOUD_ACCENT_CHROMA,
  LOUD_BG_CHROMA,
  LOUD_FACTOR,
  RAINBOW_FACTOR,
  RAINBOW_MEAN_CHROMA,
  RAINBOW_MIN_FAMILIES,
  TINTED_BG_CHROMA,
} from '../definitions/paletteConstants.js'

/**
 * 候选配色的评分与彼此的距离。评分是显式规则的系数之积，不用学来的权重。距离以“色系组合”为主：
 * 一眼看过去是不是同一类颜色（绿、褐、蓝……），只换深浅的几套算作相近；其次是底色明暗，再次才是颜色差。
 */

export interface PaletteColors {
  readonly bg: Oklab
  readonly surface: Oklab
  readonly ink: Oklab
  readonly muted: Oklab
  readonly accent: readonly Oklab[]
  /** 按 CHART_SERIES_COUNT 重采样，系列数不同的配色也能逐位比较。 */
  readonly chart: readonly Oklab[]
  /** 这套配色用到的色系：强调色的色系，底色有明显颜色时加上底的色系。 */
  readonly families: ReadonlySet<string>
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

function familiesOf(bg: Oklab, accents: readonly Oklab[]): Set<string> {
  const families = new Set<string>()
  for (const accent of accents) {
    const family = colorFamily(oklabToOklch(accent), FAMILY_MIN_CHROMA)
    if (family) families.add(family)
  }
  const ground = colorFamily(oklabToOklch(bg), TINTED_BG_CHROMA)
  if (ground) families.add(ground)
  return families
}

export function paletteColors(palette: Palette): PaletteColors {
  const bg = labOf(palette.bg)
  const accent = palette.accent.map(labOf)
  return {
    bg,
    surface: labOf(palette.surface),
    ink: labOf(palette.ink),
    muted: labOf(palette.muted),
    accent,
    chart: resample(palette.chart.map(labOf), CHART_SERIES_COUNT),
    families: familiesOf(bg, accent),
  }
}

/** 这套配色用到的色系名（如 绿、橙褐、黄），按出现顺序。 */
export function paletteFamilies(palette: Palette): string[] {
  return [...paletteColors(palette).families]
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
  const meanAccentChroma = colors.accent.reduce((sum, color) => sum + oklabToOklch(color).c, 0) / Math.max(1, colors.accent.length)
  if (colors.families.size >= RAINBOW_MIN_FAMILIES && meanAccentChroma > RAINBOW_MEAN_CHROMA) score *= RAINBOW_FACTOR
  return score
}

function weightedColorDistance(left: PaletteColors, right: PaletteColors): number {
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

/** 色系组合的 Jaccard 距离：0 表示用的是同一组色系，1 表示完全不同；都没有色系（全灰）时算相同。 */
function familyDistance(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  const union = new Set([...left, ...right])
  if (union.size === 0) return 0
  const shared = [...left].filter(family => right.has(family)).length
  return 1 - shared / union.size
}

/** 两套配色的距离：色系组合为主，底色明暗不同加一项，颜色差（角色加权 ΔEOK）只作细分。 */
export function paletteDistance(left: Palette, right: Palette, leftColors = paletteColors(left), rightColors = paletteColors(right)): number {
  return FAMILY_DISTANCE_WEIGHT * familyDistance(leftColors.families, rightColors.families)
    + (left.base !== right.base ? BASE_DISTANCE : 0)
    + COLOR_DISTANCE_WEIGHT * weightedColorDistance(leftColors, rightColors)
}
