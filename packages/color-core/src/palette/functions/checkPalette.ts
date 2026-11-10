import type { Oklch, RgbChannels } from '../../definitions/color.js'
import { rgbToOklch } from '../../functions/colorSpace.js'
import { contrastRatio } from '../../functions/contrast.js'
import { parseColor, toHex } from '../../functions/parseColor.js'
import type {
  CheckPaletteInput,
  HueRange,
  PaletteCheckResult,
  PaletteCheckRule,
  PaletteDraft,
  PaletteFinding,
} from '../definitions/palette.js'
import {
  ACCENT_MIN_CONTRAST,
  EXCLUSION_MARGIN,
  INK_MIN_CONTRAST,
  MUTED_MIN_CONTRAST,
} from '../definitions/paletteConstants.js'
import { isColorExcluded, nearestAllowedHue, withoutPinnedHues } from './excludedHues.js'
import { fitLightness, oklchHex } from './fitLightness.js'

/**
 * 检查一套不是算法生成的配色（Agent 自己写的，或用户给的色板）：对比度、排除区、图表明度顺序，与生成时同一套标准。
 * 不合格时给出改动最少的版本：色相只挪出排除区，对比度只调明度，图表只重排；用户指定的颜色不动，要调就调底色。
 */

/** OKLCH 明度低于它算深底，图表要从浅到深。 */
const DARK_GROUND_MAX_LIGHTNESS = 0.5
/** 重排后明度相同的相邻系列，至少拉开这么多，保证严格单调。 */
const CHART_MIN_LIGHTNESS_STEP = 0.015
const FULL_HUE_SEARCH = 180

interface Context {
  readonly excluded: readonly HueRange[]
  readonly pinned: ReadonlySet<string>
}

function normalized(hex: string): string | null {
  const parsed = parseColor(hex)
  return parsed ? toHex(parsed.channels) : null
}

function channelsOf(hex: string): RgbChannels | null {
  return parseColor(hex)?.channels ?? null
}

function oklchOf(hex: string): Oklch | null {
  const channels = channelsOf(hex)
  return channels ? rgbToOklch(channels) : null
}

function isPinned(hex: string, context: Context): boolean {
  const value = normalized(hex)
  return value !== null && context.pinned.has(value)
}

function isDarkGround(bg: Oklch): boolean {
  return bg.l < DARK_GROUND_MAX_LIGHTNESS
}

function allRoles(palette: PaletteDraft): (readonly [string, string])[] {
  return [
    ['bg', palette.bg],
    ['surface', palette.surface],
    ['ink', palette.ink],
    ['muted', palette.muted],
    ...palette.accent.map((hex, index) => [`accent[${index}]`, hex] as const),
    ...palette.chart.map((hex, index) => [`chart[${index}]`, hex] as const),
  ]
}

function contrastRules(palette: PaletteDraft): (readonly [PaletteCheckRule, string, string, number])[] {
  return [
    ['ink_contrast', 'ink', palette.ink, INK_MIN_CONTRAST],
    ['muted_contrast', 'muted', palette.muted, MUTED_MIN_CONTRAST],
    ...palette.accent.map((hex, index) => ['accent_contrast', `accent[${index}]`, hex, ACCENT_MIN_CONTRAST] as const),
  ]
}

function isChartOrdered(chart: readonly string[], dark: boolean): boolean {
  const lightness = chart.map(hex => oklchOf(hex)?.l ?? 0)
  return lightness.slice(1).every((value, index) => (value - (lightness[index] ?? 0)) * (dark ? -1 : 1) > 0)
}

function evaluate(palette: PaletteDraft, context: Context): PaletteFinding[] {
  const findings: PaletteFinding[] = []
  const roles = allRoles(palette)
  for (const [role, value] of roles) {
    if (!channelsOf(value)) findings.push({ rule: 'invalid_color', role, value })
  }
  if (findings.length > 0) return findings

  for (const [role, value] of roles) {
    const color = oklchOf(value)
    if (color && !isPinned(value, context) && isColorExcluded(color, context.excluded)) findings.push({ rule: 'excluded_hue', role, value })
  }
  const background = channelsOf(palette.bg)
  const bg = oklchOf(palette.bg)
  if (!background || !bg) return findings
  for (const [rule, role, value, required] of contrastRules(palette)) {
    const channels = channelsOf(value)
    if (!channels) continue
    const measured = contrastRatio(channels, background)
    if (measured < required) findings.push({ rule, role, value, measured: Math.round(measured * 100) / 100, required })
  }
  if (!isChartOrdered(palette.chart, isDarkGround(bg))) findings.push({ rule: 'chart_order', role: 'chart', value: palette.chart.join(',') })
  return findings
}

function outOfExcluded(hex: string, context: Context): string {
  const color = oklchOf(hex)
  if (!color || isPinned(hex, context) || !isColorExcluded(color, context.excluded)) return hex
  const hue = nearestAllowedHue(color.h, context.excluded, EXCLUSION_MARGIN, FULL_HUE_SEARCH)
  return hue === null ? hex : oklchHex({ ...color, h: hue })
}

/** 只调明度达到对比度：先往离开底色的方向，走不通再往另一边。 */
function withContrast(hex: string, background: RgbChannels, required: number, dark: boolean): string {
  const color = oklchOf(hex)
  if (!color) return hex
  const fitted = fitLightness(color, background, required, dark ? 'lighter' : 'darker')
    ?? fitLightness(color, background, required, dark ? 'darker' : 'lighter')
  return fitted ? oklchHex(fitted) : hex
}

/**
 * 指定色对比度不够时调底色：先沿原来的明暗方向，走不通再翻到另一边（如灰底上的亮黄只能换深底），
 * 同时给正文留出对比度。底色本身也是指定色，或指定色都合格时不动。
 */
function groundForPinned(palette: PaletteDraft, context: Context): string {
  const original = oklchOf(palette.bg)
  const background = channelsOf(palette.bg)
  if (!original || !background || isPinned(palette.bg, context)) return palette.bg
  const pinnedRules = contrastRules(palette).flatMap(([, , value, required]) => {
    const channels = channelsOf(value)
    return channels && isPinned(value, context) ? [{ channels, required }] : []
  })
  if (pinnedRules.every(rule => contrastRatio(rule.channels, background) >= rule.required)) return palette.bg
  const directions = isDarkGround(original) ? (['darker', 'lighter'] as const) : (['lighter', 'darker'] as const)
  for (const direction of directions) {
    let fitted: Oklch | null = original
    for (const rule of pinnedRules) fitted = fitted && fitLightness(fitted, rule.channels, rule.required, direction)
    const text = channelsOf(direction === 'darker' ? '#ffffff' : '#000000')
    if (fitted && text) fitted = fitLightness(fitted, text, INK_MIN_CONTRAST, direction)
    if (fitted && pinnedRules.every(rule => {
      const final = channelsOf(oklchHex(fitted as Oklch))
      return final !== null && contrastRatio(rule.channels, final) >= rule.required
    })) return oklchHex(fitted)
  }
  return palette.bg
}

/** 底色调过明度时，面色跟着平移，两者的层次不变。 */
function surfaceFollowing(surface: string, previousBg: string, nextBg: string): string {
  const color = oklchOf(surface)
  const before = oklchOf(previousBg)
  const after = oklchOf(nextBg)
  if (!color || !before || !after || previousBg === nextBg) return surface
  return oklchHex({ ...color, l: Math.min(1, Math.max(0, color.l + after.l - before.l)) })
}

function orderedChart(chart: readonly string[], dark: boolean): string[] {
  if (isChartOrdered(chart, dark)) return [...chart]
  const colors = chart.map(oklchOf).filter((color): color is Oklch => color !== null)
  const sorted = [...colors].sort((left, right) => (dark ? right.l - left.l : left.l - right.l))
  const direction = dark ? -1 : 1
  const spaced: Oklch[] = []
  for (const color of sorted) {
    const previous = spaced[spaced.length - 1]
    const crowded = previous !== undefined && (color.l - previous.l) * direction < CHART_MIN_LIGHTNESS_STEP
    spaced.push(crowded ? { ...color, l: previous.l + direction * CHART_MIN_LIGHTNESS_STEP } : color)
  }
  return spaced.map(oklchHex)
}

function repaired(palette: PaletteDraft, context: Context): PaletteDraft | null {
  const hueFixed: PaletteDraft = {
    bg: outOfExcluded(palette.bg, context),
    surface: outOfExcluded(palette.surface, context),
    ink: outOfExcluded(palette.ink, context),
    muted: outOfExcluded(palette.muted, context),
    accent: palette.accent.map(hex => outOfExcluded(hex, context)),
    chart: palette.chart.map(hex => outOfExcluded(hex, context)),
  }
  const bg = groundForPinned(hueFixed, context)
  const background = channelsOf(bg)
  const ground = oklchOf(bg)
  if (!background || !ground) return null
  const dark = isDarkGround(ground)
  const fit = (hex: string, required: number) => (isPinned(hex, context) ? hex : withContrast(hex, background, required, dark))
  const candidate: PaletteDraft = {
    bg,
    surface: isPinned(hueFixed.surface, context) ? hueFixed.surface : surfaceFollowing(hueFixed.surface, hueFixed.bg, bg),
    ink: fit(hueFixed.ink, INK_MIN_CONTRAST),
    muted: fit(hueFixed.muted, MUTED_MIN_CONTRAST),
    accent: hueFixed.accent.map(hex => fit(hex, ACCENT_MIN_CONTRAST)),
    chart: orderedChart(hueFixed.chart, dark),
  }
  return evaluate(candidate, context).length === 0 ? candidate : null
}

export function checkPalette(input: CheckPaletteInput): PaletteCheckResult {
  const pinnedHexes = (input.pinnedColors ?? []).map(normalized).filter((hex): hex is string => hex !== null)
  const pinnedHues = pinnedHexes.map(oklchOf).filter((color): color is Oklch => color !== null).map(color => color.h)
  const context: Context = {
    excluded: withoutPinnedHues(input.excludedHues ?? [], pinnedHues),
    pinned: new Set(pinnedHexes),
  }
  const findings = evaluate(input.palette, context)
  if (findings.length === 0) return { ok: true, findings, suggested: null }
  const fixable = findings.every(finding => finding.rule !== 'invalid_color')
  return { ok: false, findings, suggested: fixable ? repaired(input.palette, context) : null }
}
