import type { Oklch } from '../../definitions/color.js'
import { isHueWithinArc, normalizeHue } from '../../functions/hue.js'
import { parseColor } from '../../functions/parseColor.js'
import type { HueRange, Palette, PaletteBase, PaletteRelation } from '../definitions/palette.js'
import {
  ACCENT_CHROMA,
  ACCENT_CHROMA_JITTER,
  ACCENT_LIGHTNESS_JITTER,
  ACCENT_MIN_CONTRAST,
  ANALOG_HUE_SHIFT,
  BASE_TONES,
  BEIGE_HUES,
  CHART_CHROMA,
  CHART_CHROMA_TAPER,
  CHART_SERIES_COUNT,
  EXCLUSION_MARGIN,
  INK_MIN_CONTRAST,
  INK_RELATION_MAX_CHROMA,
  MUTED_MIN_CONTRAST,
  PAPER_MAX_SUBJECT_CHROMA_RATIO,
  type RangeValue,
} from '../definitions/paletteConstants.js'
import { isColorExcluded, isHueExcluded, nearestAllowedHue } from './excludedHues.js'
import { fitLightness, oklchHex } from './fitLightness.js'
import { randomBetween, type RandomSource } from './random.js'

/**
 * 按“关系 × 底色明暗”生成一套配色的六个角色。明度、彩度档位见 BASE_TONES；墨、弱墨、点题色在期望明度上
 * 保证对比度下限；所有有彩颜色都避开排除区，做不到就返回 null，由调用方换一个组合。
 */

export interface PaletteRecipe {
  readonly id: string
  readonly relation: PaletteRelation
  readonly base: PaletteBase
  /** 题材本色，第一种为主。 */
  readonly subject: readonly Oklch[]
  readonly excluded: readonly HueRange[]
  readonly random: RandomSource
}

function clamp(value: number, range: RangeValue): number {
  return Math.min(range.max, Math.max(range.min, value))
}

function signedHueDifference(from: number, to: number): number {
  const difference = normalizeHue(to - from)
  return difference > 180 ? difference - 360 : difference
}

function analogShift(recipe: PaletteRecipe, hue: number): number | null {
  const magnitude = randomBetween(recipe.random, ANALOG_HUE_SHIFT.min, ANALOG_HUE_SHIFT.max)
  const preferred = recipe.random() < 0.5 ? 1 : -1
  for (const sign of [preferred, -preferred]) {
    const shift = sign * magnitude
    const steps = Array.from({ length: CHART_SERIES_COUNT }, (_, index) => hue + (shift * index) / (CHART_SERIES_COUNT - 1))
    if (steps.every(step => !isHueExcluded(step, recipe.excluded, EXCLUSION_MARGIN))) return shift
  }
  return null
}

/** 点题色落入排除区时沿色相轴移到最近的允许色相，移动超过这个角度就放弃该组合。 */
const MAX_ACCENT_HUE_SHIFT = 30

function accentFrom(recipe: PaletteRecipe, source: Oklch, wantedHue: number, background: readonly [number, number, number]): Oklch | null {
  const tones = BASE_TONES[recipe.base]
  const hue = nearestAllowedHue(wantedHue, recipe.excluded, EXCLUSION_MARGIN, MAX_ACCENT_HUE_SHIFT)
  if (hue === null) return null
  const jitteredChroma = source.c * (1 + randomBetween(recipe.random, -ACCENT_CHROMA_JITTER, ACCENT_CHROMA_JITTER))
  const preferredLightness = recipe.base === 'dark' ? source.l + 0.22 : source.l
  const lightness = clamp(
    preferredLightness + randomBetween(recipe.random, -ACCENT_LIGHTNESS_JITTER, ACCENT_LIGHTNESS_JITTER),
    tones.accentLightness,
  )
  return fitLightness(
    { l: lightness, c: clamp(jitteredChroma, ACCENT_CHROMA), h: hue },
    background,
    ACCENT_MIN_CONTRAST,
    recipe.base === 'dark' ? 'lighter' : 'darker',
  )
}

function chartRamp(recipe: PaletteRecipe, primary: Oklch, hues: readonly number[]): Oklch[] {
  const [from, to] = BASE_TONES[recipe.base].chartLightness
  const firstChroma = clamp(primary.c, CHART_CHROMA)
  return hues.map((hue, index) => {
    const t = hues.length === 1 ? 0 : index / (hues.length - 1)
    return { l: from + (to - from) * t, c: firstChroma * (1 - (1 - CHART_CHROMA_TAPER) * t), h: hue }
  })
}

/** 墨色主导：点题色打头，其余是同一墨色的中性灰阶，明度单调。 */
function emphasisChart(recipe: PaletteRecipe, accent: Oklch, hue: number): Oklch[] {
  const dark = recipe.base === 'dark'
  const grays = dark ? [0.62, 0.52, 0.44, 0.37] : [0.62, 0.72, 0.81, 0.89]
  const startsAfterAccent = dark ? grays.filter(lightness => lightness < accent.l) : grays.filter(lightness => lightness > accent.l)
  return [accent, ...startsAfterAccent.map(lightness => ({ l: lightness, c: 0.004, h: hue }))]
}

function isBeige(color: Oklch): boolean {
  return isHueWithinArc(color.h, BEIGE_HUES.min, BEIGE_HUES.max)
}

export function buildPalette(recipe: PaletteRecipe): Palette | null {
  const tones = BASE_TONES[recipe.base]
  const [first, second] = recipe.subject
  if (!first) return null
  // 双本色时，非米色的本色做底与墨，另一种做点题（例如铜锈绿做底、铜金点题）。
  const swap = recipe.relation === 'dual' && second !== undefined && isBeige(first) && !isBeige(second)
  // 染纸底不铺米色：同色系、邻近色改用第一种非米色本色；墨色主导的底几乎无彩，不受影响。
  const paperSubject = recipe.base === 'tint' && recipe.relation !== 'dual' && recipe.relation !== 'ink' && isBeige(first)
    ? recipe.subject.find(color => !isBeige(color))
    : undefined
  const primary = swap && second ? second : paperSubject ?? first
  const partner = swap ? first : second
  if (recipe.base === 'tint' && recipe.relation !== 'ink' && isBeige(primary)) return null
  const hue = primary.h
  const inkRelation = recipe.relation === 'ink'
  const tintChroma = (range: RangeValue) => {
    const chroma = randomBetween(recipe.random, range.min, range.max)
    return inkRelation ? Math.min(chroma, INK_RELATION_MAX_CHROMA) : chroma
  }

  const bgColor: Oklch = {
    l: randomBetween(recipe.random, tones.bgLightness.min, tones.bgLightness.max),
    c: Math.min(tintChroma(tones.bgChroma), primary.c * PAPER_MAX_SUBJECT_CHROMA_RATIO),
    h: hue,
  }
  const bgHex = oklchHex(bgColor)
  const background = parseColor(bgHex)?.channels
  if (!background) return null
  const surfaceColor: Oklch = {
    l: bgColor.l + tones.surfaceLightnessOffset,
    c: inkRelation ? Math.min(bgColor.c + tones.surfaceChromaOffset, INK_RELATION_MAX_CHROMA) : bgColor.c + tones.surfaceChromaOffset,
    h: hue,
  }
  const textDirection = recipe.base === 'dark' ? 'lighter' : 'darker'
  const textChroma = (chroma: number) => inkRelation ? Math.min(chroma, INK_RELATION_MAX_CHROMA) : Math.min(chroma, primary.c)
  const ink = fitLightness({ l: tones.inkLightness, c: textChroma(tones.inkChroma), h: hue }, background, INK_MIN_CONTRAST, textDirection)
  const muted = fitLightness({ l: tones.mutedLightness, c: textChroma(tones.mutedChroma), h: hue }, background, MUTED_MIN_CONTRAST, textDirection)
  if (!ink || !muted) return null

  let accents: Oklch[]
  let chart: Oklch[]
  if (recipe.relation === 'analog') {
    const shift = analogShift(recipe, hue)
    if (shift === null) return null
    const accent = accentFrom(recipe, primary, normalizeHue(hue + shift), background)
    if (!accent) return null
    accents = [accent]
    chart = chartRamp(recipe, primary, Array.from({ length: CHART_SERIES_COUNT }, (_, index) => normalizeHue(hue + (shift * index) / (CHART_SERIES_COUNT - 1))))
  } else if (recipe.relation === 'dual') {
    if (!partner) return null
    const secondAccent = accentFrom(recipe, partner, partner.h, background)
    const firstAccent = accentFrom(recipe, primary, hue, background)
    if (!secondAccent || !firstAccent) return null
    accents = [secondAccent, firstAccent]
    // 本身更暗的本色占色阶的深色一端，各自落在原本的明度上（例如深朱在深端、叶绿在浅端）。
    const [deepEnd, paleEnd] = partner.l < primary.l ? [partner, primary] : [primary, partner]
    const darkBase = recipe.base === 'dark'
    const [startHue, endHue] = darkBase ? [paleEnd.h, deepEnd.h] : [deepEnd.h, paleEnd.h]
    const span = signedHueDifference(startHue, endHue)
    chart = chartRamp(recipe, primary, Array.from({ length: CHART_SERIES_COUNT }, (_, index) => normalizeHue(startHue + (span * index) / (CHART_SERIES_COUNT - 1))))
  } else {
    const accent = accentFrom(recipe, primary, hue, background)
    if (!accent) return null
    accents = [accent]
    chart = inkRelation ? emphasisChart(recipe, accent, hue) : chartRamp(recipe, primary, Array.from({ length: CHART_SERIES_COUNT }, () => hue))
  }

  const everyColor = [bgColor, surfaceColor, ink, muted, ...accents, ...chart]
  if (everyColor.some(color => isColorExcluded(color, recipe.excluded))) return null

  return {
    id: recipe.id,
    relation: recipe.relation,
    base: recipe.base,
    bg: bgHex,
    surface: oklchHex(surfaceColor),
    ink: oklchHex(ink),
    muted: oklchHex(muted),
    accent: accents.map(oklchHex),
    chart: chart.map(oklchHex),
  }
}
