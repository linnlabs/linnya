import type { Oklch, RgbChannels } from '../../definitions/color.js'
import { maxSrgbChroma } from '../../functions/colorSpace.js'
import { isHueWithinArc, normalizeHue } from '../../functions/hue.js'
import { parseColor } from '../../functions/parseColor.js'
import type { HueRange, Palette, PaletteBase, PaletteRelation, PaletteTone } from '../definitions/palette.js'
import {
  ACCENT_CHROMA_JITTER,
  ACCENT_LIGHTNESS_JITTER,
  ACCENT_MIN_CHROMA,
  ACCENT_MIN_CONTRAST,
  ACCENT_TONES,
  ANALOG_HUE_SHIFT,
  BEIGE_HUES,
  CHART_CHROMA_TAPER,
  CHART_DARK_GROUND_GAP,
  CHART_END_MAX_CHROMA_RATIO,
  CHART_HUE_DRIFT,
  CHART_LIGHTNESS,
  CHART_MAX_CHROMA,
  CHART_MIN_LIGHTNESS_SPAN,
  CHART_NO_DRIFT_PROBABILITY,
  CHART_RELATIVE_CHROMA,
  CHART_SERIES_COUNT,
  COOL_NEUTRAL_HUE,
  DUAL_SWAP_PROBABILITY,
  EMPHASIS_GRAY_CHROMA,
  EXCLUSION_MARGIN,
  type GroundVariant,
  INK_MIN_CONTRAST,
  INK_RELATION_MAX_CHROMA,
  MAX_ACCENT_HUE_SHIFT,
  MUTED_MIN_CONTRAST,
  NATIVE_ACCENT_CHROMA,
  NATIVE_DARK_LIGHTNESS_LIFT,
  type RangeValue,
  TEXT_TONES,
  type ToneSpec,
  type ToneSurface,
} from '../definitions/paletteConstants.js'
import { isColorExcluded, isHueExcluded, nearestAllowedHue } from './excludedHues.js'
import { fitLightness, oklchHex } from './fitLightness.js'
import { randomBetween, type RandomSource } from './random.js'

/**
 * 按一组风格基因生成一套配色的六个角色：关系定色相，底面变体定纸，色调定点题与图表的鲜浊深浅，
 * 图表明度区间、彩度收尾与色相漂移在区间里随机取。墨、弱墨、点题色在期望明度上保证对比度下限；
 * 所有有彩颜色都避开排除区，做不到就返回 null，由调用方丢掉这个候选。
 */

export interface PaletteRecipe {
  readonly id: string
  readonly relation: PaletteRelation
  readonly base: PaletteBase
  readonly ground: GroundVariant
  readonly tone: PaletteTone
  /** 题材本色，第一种为主。 */
  readonly subject: readonly Oklch[]
  readonly excluded: readonly HueRange[]
  readonly random: RandomSource
}

function clamp(value: number, range: RangeValue): number {
  return Math.min(range.max, Math.max(range.min, value))
}

function between(recipe: PaletteRecipe, range: RangeValue): number {
  return randomBetween(recipe.random, range.min, range.max)
}

function signedHueDifference(from: number, to: number): number {
  const difference = normalizeHue(to - from)
  return difference > 180 ? difference - 360 : difference
}

function isBeige(color: Oklch): boolean {
  return isHueWithinArc(color.h, BEIGE_HUES.min, BEIGE_HUES.max)
}

function surfaceOf(base: PaletteBase): ToneSurface {
  return base === 'dark' ? 'dark' : 'paper'
}

function hueStepsAllowed(recipe: PaletteRecipe, hues: readonly number[]): boolean {
  return hues.every(hue => !isHueExcluded(hue, recipe.excluded, EXCLUSION_MARGIN))
}

function rampHues(from: number, span: number): number[] {
  return Array.from({ length: CHART_SERIES_COUNT }, (_, index) => normalizeHue(from + (span * index) / (CHART_SERIES_COUNT - 1)))
}

function analogShift(recipe: PaletteRecipe, hue: number): number | null {
  const magnitude = between(recipe, ANALOG_HUE_SHIFT)
  const preferred = recipe.random() < 0.5 ? 1 : -1
  for (const sign of [preferred, -preferred]) {
    if (hueStepsAllowed(recipe, rampHues(hue, sign * magnitude))) return sign * magnitude
  }
  return null
}

/** 同色系图表的色相漂移：有一定概率不漂；漂移会碰到排除区时也不漂。 */
function monoDrift(recipe: PaletteRecipe, hue: number): number {
  if (recipe.random() < CHART_NO_DRIFT_PROBABILITY) return 0
  const drift = (recipe.random() < 0.5 ? -1 : 1) * between(recipe, CHART_HUE_DRIFT)
  return hueStepsAllowed(recipe, rampHues(hue, drift)) ? drift : 0
}

function toneSpec(recipe: PaletteRecipe): ToneSpec | null {
  return ACCENT_TONES[surfaceOf(recipe.base)][recipe.tone] ?? null
}

/** 相对彩度：彩度 ÷ 该明度色相下 sRGB 的最大彩度。 */
function relativeChromaOf(color: Oklch): number {
  const max = maxSrgbChroma(color.l, color.h)
  return max > 0 ? Math.min(1, color.c / max) : 0
}

function accentFrom(recipe: PaletteRecipe, source: Oklch, wantedHue: number, background: RgbChannels): Oklch | null {
  const spec = toneSpec(recipe)
  if (!spec) return null
  const hue = nearestAllowedHue(wantedHue, recipe.excluded, EXCLUSION_MARGIN, MAX_ACCENT_HUE_SHIFT)
  if (hue === null) return null
  let target: Oklch
  if (recipe.tone === 'native') {
    const preferred = recipe.base === 'dark' ? source.l + NATIVE_DARK_LIGHTNESS_LIFT : source.l
    const lightness = clamp(preferred + randomBetween(recipe.random, -ACCENT_LIGHTNESS_JITTER, ACCENT_LIGHTNESS_JITTER), spec.lightness)
    const chroma = clamp(source.c * (1 + randomBetween(recipe.random, -ACCENT_CHROMA_JITTER, ACCENT_CHROMA_JITTER)), NATIVE_ACCENT_CHROMA)
    target = { l: lightness, c: chroma, h: hue }
  } else {
    const lightness = between(recipe, spec.lightness)
    const chroma = Math.min(spec.maxChroma, between(recipe, spec.relativeChroma) * maxSrgbChroma(lightness, hue))
    target = { l: lightness, c: Math.max(ACCENT_MIN_CHROMA, chroma), h: hue }
  }
  return fitLightness(target, background, ACCENT_MIN_CONTRAST, recipe.base === 'dark' ? 'lighter' : 'darker')
}

/** 图表首尾明度：浅底从深到浅、深底从浅到深；深底上最暗一档与底色拉开。 */
function chartLightness(recipe: PaletteRecipe, background: Oklch): readonly [number, number] {
  const range = CHART_LIGHTNESS[surfaceOf(recipe.base)]
  const start = between(recipe, range.start)
  let end = between(recipe, range.end)
  if (recipe.base === 'dark') end = Math.min(start - CHART_MIN_LIGHTNESS_SPAN, Math.max(end, background.l + CHART_DARK_GROUND_GAP))
  else end = Math.max(end, start + CHART_MIN_LIGHTNESS_SPAN)
  return [start, end]
}

function chartRamp(recipe: PaletteRecipe, accent: Oklch, hues: readonly number[], lightness: readonly [number, number]): Oklch[] {
  const [from, to] = lightness
  const firstRelative = clamp(relativeChromaOf(accent) * randomBetween(recipe.random, 0.8, 1), CHART_RELATIVE_CHROMA)
  const taper = between(recipe, CHART_CHROMA_TAPER)
  return hues.map((hue, index) => {
    const t = hues.length === 1 ? 0 : index / (hues.length - 1)
    const l = from + (to - from) * t
    const relative = firstRelative * (1 - (1 - taper) * t)
    const cap = CHART_MAX_CHROMA * (1 - (1 - CHART_END_MAX_CHROMA_RATIO) * t)
    return { l, c: Math.min(cap, relative * maxSrgbChroma(l, hue)), h: hue }
  })
}

/** 墨色主导：点题色打头，其余是近中性的灰阶，明度单调。 */
function emphasisChart(recipe: PaletteRecipe, accent: Oklch, neutralHue: number, background: Oklch): Oklch[] {
  const dark = recipe.base === 'dark'
  const step = 0.08
  const first = dark ? accent.l - step : accent.l + step
  const last = dark ? Math.max(background.l + CHART_DARK_GROUND_GAP - 0.04, randomBetween(recipe.random, 0.34, 0.42)) : randomBetween(recipe.random, 0.86, 0.92)
  if (dark ? first <= last : first >= last) return [accent]
  const count = CHART_SERIES_COUNT - 1
  const grays = Array.from({ length: count }, (_, index) => ({ l: first + ((last - first) * index) / (count - 1), c: EMPHASIS_GRAY_CHROMA, h: neutralHue }))
  return [accent, ...grays]
}

export function buildPalette(recipe: PaletteRecipe): Palette | null {
  const text = TEXT_TONES[recipe.base]
  const ground = recipe.ground
  const [first, second] = recipe.subject
  if (!first) return null
  const inkRelation = recipe.relation === 'ink'
  // 墨色主导要的是近中性的纸，不配本色深底。
  if (inkRelation && ground.key === 'deep') return null
  // 双本色时两种本色都可以做底与墨，另一种做点题（例如铜锈绿做底、铜金点题；深朱做酒红底、叶绿点题）。
  // 染纸底只让非米色的本色做底。
  const dual = recipe.relation === 'dual' && second !== undefined
  const swap = dual && (recipe.base === 'tint'
    ? isBeige(first) && !isBeige(second)
    : recipe.random() < DUAL_SWAP_PROBABILITY)
  // 染纸底不铺米色：同色系、邻近色改用第一种非米色本色；墨色主导的底几乎无彩，不受影响。
  const paperSubject = recipe.base === 'tint' && recipe.relation !== 'dual' && !inkRelation && isBeige(first)
    ? recipe.subject.find(color => !isBeige(color))
    : undefined
  const primary = swap && second ? second : paperSubject ?? first
  const partner = swap ? first : second
  if (recipe.base === 'tint' && !inkRelation && isBeige(primary)) return null
  const hue = primary.h
  const neutralHue = ground.neutralHue === 'cool' ? COOL_NEUTRAL_HUE : hue
  const capInk = (chroma: number) => inkRelation ? Math.min(chroma, INK_RELATION_MAX_CHROMA) : chroma

  const bgColor: Oklch = {
    l: between(recipe, ground.bgLightness),
    c: capInk(Math.min(between(recipe, ground.bgChroma), primary.c * ground.maxSubjectChromaRatio)),
    h: neutralHue,
  }
  const bgHex = oklchHex(bgColor)
  const background = parseColor(bgHex)?.channels
  if (!background) return null
  const surfaceColor: Oklch = {
    l: bgColor.l + ground.surfaceLightnessOffset,
    c: capInk(bgColor.c + ground.surfaceChromaOffset),
    h: neutralHue,
  }
  const textDirection = recipe.base === 'dark' ? 'lighter' : 'darker'
  const textChroma = (chroma: number) => inkRelation ? Math.min(chroma, INK_RELATION_MAX_CHROMA) : Math.min(chroma, primary.c)
  const ink = fitLightness({ l: text.inkLightness, c: textChroma(text.inkChroma), h: neutralHue }, background, INK_MIN_CONTRAST, textDirection)
  const muted = fitLightness({ l: text.mutedLightness, c: textChroma(text.mutedChroma), h: neutralHue }, background, MUTED_MIN_CONTRAST, textDirection)
  if (!ink || !muted) return null

  let accents: Oklch[]
  let chart: Oklch[]
  if (recipe.relation === 'analog') {
    const shift = analogShift(recipe, hue)
    if (shift === null) return null
    const accent = accentFrom(recipe, primary, normalizeHue(hue + shift), background)
    if (!accent) return null
    accents = [accent]
    chart = chartRamp(recipe, accent, rampHues(hue, shift), chartLightness(recipe, bgColor))
  } else if (recipe.relation === 'dual') {
    if (!partner) return null
    const secondAccent = accentFrom(recipe, partner, partner.h, background)
    const firstAccent = accentFrom(recipe, primary, hue, background)
    if (!secondAccent || !firstAccent) return null
    accents = [secondAccent, firstAccent]
    // 本身更暗的本色占色阶的深色一端（例如深朱在深端、叶绿在浅端）。
    const [deepEnd, paleEnd] = partner.l < primary.l ? [partner, primary] : [primary, partner]
    const [startHue, endHue] = recipe.base === 'dark' ? [paleEnd.h, deepEnd.h] : [deepEnd.h, paleEnd.h]
    chart = chartRamp(recipe, firstAccent, rampHues(startHue, signedHueDifference(startHue, endHue)), chartLightness(recipe, bgColor))
  } else {
    const accent = accentFrom(recipe, primary, hue, background)
    if (!accent) return null
    accents = [accent]
    chart = inkRelation
      ? emphasisChart(recipe, accent, neutralHue, bgColor)
      : chartRamp(recipe, accent, rampHues(hue, monoDrift(recipe, hue)), chartLightness(recipe, bgColor))
  }

  const everyColor = [bgColor, surfaceColor, ink, muted, ...accents, ...chart]
  if (everyColor.some(color => isColorExcluded(color, recipe.excluded))) return null

  return {
    id: recipe.id,
    relation: recipe.relation,
    base: recipe.base,
    tone: recipe.tone,
    bg: bgHex,
    surface: oklchHex(surfaceColor),
    ink: oklchHex(ink),
    muted: oklchHex(muted),
    accent: accents.map(oklchHex),
    chart: chart.map(oklchHex),
  }
}
