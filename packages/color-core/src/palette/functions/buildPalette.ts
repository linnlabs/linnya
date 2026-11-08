import type { Oklab, Oklch, RgbChannels } from '../../definitions/color.js'
import { deltaEOK, maxSrgbChroma, oklabToOklch, oklchToOklab, rgbToOklab } from '../../functions/colorSpace.js'
import { hueDistance, isHueWithinArc, normalizeHue } from '../../functions/hue.js'
import { parseColor } from '../../functions/parseColor.js'
import type { HueRange, Palette, PaletteBase, PaletteRelation, PaletteTone } from '../definitions/palette.js'
import {
  ACCENT_CHROMA_JITTER,
  ACCENT_LIGHTNESS_JITTER,
  ACCENT_MIN_CHROMA,
  ACCENT_MIN_CONTRAST,
  ACCENT_MIN_SEPARATION,
  ACCENT_TONE_STEP,
  ACCENT_TONES,
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
  DEFAULT_ACCENT_COUNT,
  EMPHASIS_GRAY_CHROMA,
  EXCLUSION_MARGIN,
  type GroundVariant,
  IMAGE_PARTNER_PROBABILITY,
  INK_MIN_CONTRAST,
  INK_RELATION_MAX_CHROMA,
  MAX_ACCENT_COUNT,
  MAX_ACCENT_HUE_SHIFT,
  MULTI_MAX_HUES,
  MULTI_MIN_SUBJECTS,
  MUTED_MIN_CONTRAST,
  NATIVE_ACCENT_CHROMA,
  NATIVE_DARK_LIGHTNESS_LIFT,
  PARTNER_MIN_HUE_DIFFERENCE,
  PRIMARY_SUBJECT_WEIGHTS,
  type RangeValue,
  RELATION_HUE_SHIFT,
  SYNTHESIZED_HUE_SHIFT_MAX,
  TEXT_TONES,
  type ToneSurface,
} from '../definitions/paletteConstants.js'
import { isColorExcluded, isHueExcluded, nearestAllowedHue } from './excludedHues.js'
import { fitLightness, oklchHex } from './fitLightness.js'
import { randomBetween, type RandomSource } from './random.js'

/**
 * 按一组风格基因生成一套配色：关系定用哪几个色相（图片里真有的颜色优先），底面变体定纸，色调定强调色与图表的
 * 鲜浊深浅；强调色按色相轮流取，色相用完后换一档色调（tone-on-tone）。墨、弱墨、强调色在期望明度上保证对比度
 * 下限；所有有彩颜色都避开排除区，做不到就返回 null，由调用方丢掉这个候选。
 */

export interface PaletteRecipe {
  readonly id: string
  readonly relation: PaletteRelation
  readonly base: PaletteBase
  readonly ground: GroundVariant
  readonly tone: PaletteTone
  /** 题材本色，按排名；点缀色排在后面。 */
  readonly subject: readonly Oklch[]
  /** 与 `subject` 一一对应：只做搭配色、不当主色（点缀色，或只在一张图里出现的颜色）。 */
  readonly partnerOnly?: readonly boolean[]
  readonly excluded: readonly HueRange[]
  readonly random: RandomSource
  /** 强调色个数，1–6；不传按关系默认。 */
  readonly accentCount?: number
}

/** 一个用到的色相：`source` 是取它的明度与彩度时参照的颜色（图片色本身，或合成时借主色的明度与彩度）。 */
interface Anchor {
  readonly hue: number
  readonly source: Oklch
}

function clamp(value: number, range: RangeValue): number {
  return Math.min(range.max, Math.max(range.min, value))
}

function between(recipe: PaletteRecipe, range: RangeValue): number {
  return randomBetween(recipe.random, range.min, range.max)
}

function isBeige(color: Oklch): boolean {
  return isHueWithinArc(color.h, BEIGE_HUES.min, BEIGE_HUES.max)
}

function surfaceOf(base: PaletteBase): ToneSurface {
  return base === 'dark' ? 'dark' : 'paper'
}

function isAllowed(recipe: PaletteRecipe, hue: number): boolean {
  return !isHueExcluded(hue, recipe.excluded, EXCLUSION_MARGIN)
}

function pickWeighted<T>(items: readonly T[], weights: readonly number[], random: RandomSource): T | undefined {
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let target = random() * total
  for (let index = 0; index < items.length; index += 1) {
    target -= weights[index] ?? 0
    if (target <= 0) return items[index]
  }
  return items[items.length - 1]
}

/** 主色：按本色排名加权抽，每次主色不同，色系才不同。染纸底不铺米色（灰 + 主色的底几乎无彩，不受影响）。 */
function pickPrimary(recipe: PaletteRecipe): Oklch | undefined {
  const avoidBeige = recipe.base === 'tint' && recipe.relation !== 'ink'
  const candidates = recipe.subject.filter((color, index) => !recipe.partnerOnly?.[index] && (!avoidBeige || !isBeige(color)))
  if (recipe.relation === 'multi') return candidates[0]
  if (candidates.length === 0) return undefined
  return pickWeighted(candidates, candidates.map(color => PRIMARY_SUBJECT_WEIGHTS[recipe.subject.indexOf(color)] ?? 0.2), recipe.random)
}

/** 按关系定用到的色相。邻近、中差、对照优先用色相差落在区间里的图片色，没有再合成。 */
function huePlan(recipe: PaletteRecipe, primary: Oklch): Anchor[] | null {
  const main: Anchor = { hue: primary.h, source: primary }
  if (recipe.relation === 'mono' || recipe.relation === 'ink') return [main]
  if (recipe.relation === 'multi') {
    // 其余本色随机排序后依次挑：与已挑的每种都看得出不同才要，最多三种。每次挑到的组合不同。
    const others = shuffled(recipe, recipe.subject.filter(color => color !== primary && isAllowed(recipe, color.h)))
    const chosen: Oklch[] = [primary]
    for (const color of others) {
      if (chosen.length >= MULTI_MAX_HUES) break
      if (chosen.every(existing => hueDifference(existing, color) >= PARTNER_MIN_HUE_DIFFERENCE)) chosen.push(color)
    }
    if (chosen.length < MULTI_MIN_SUBJECTS) return null
    return chosen.map(color => ({ hue: color.h, source: color }))
  }
  const band = RELATION_HUE_SHIFT[recipe.relation]
  const imagePartners = recipe.subject.filter(color => {
    const distance = hueDistance(color.h, primary.h)
    return color !== primary && distance >= band.min && distance <= band.max && isAllowed(recipe, color.h)
      && hueDifference(primary, color) >= PARTNER_MIN_HUE_DIFFERENCE
  })
  if (imagePartners.length > 0 && recipe.random() < IMAGE_PARTNER_PROBABILITY) {
    const partner = imagePartners[Math.floor(recipe.random() * imagePartners.length)] ?? imagePartners[0]
    if (partner) return [main, { hue: partner.h, source: partner }]
  }
  const magnitude = between(recipe, { min: band.min, max: Math.min(band.max, SYNTHESIZED_HUE_SHIFT_MAX) })
  const preferred = recipe.random() < 0.5 ? 1 : -1
  for (const sign of [preferred, -preferred]) {
    const hue = normalizeHue(primary.h + sign * magnitude)
    if (isAllowed(recipe, hue)) return [main, { hue, source: { ...primary, h: hue } }]
  }
  return null
}

function shuffled<T>(recipe: PaletteRecipe, items: readonly T[]): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(recipe.random() * (index + 1))
    const current = result[index]
    const other = result[swap]
    if (current !== undefined && other !== undefined) {
      result[index] = other
      result[swap] = current
    }
  }
  return result
}

/** 色调顺序：第一档是这套的主色调，之后几档给同一色相的第二、三个强调色（tone-on-tone）。 */
function toneSequence(recipe: PaletteRecipe): PaletteTone[] {
  const others = (Object.keys(ACCENT_TONES[surfaceOf(recipe.base)]) as PaletteTone[]).filter(tone => tone !== recipe.tone)
  return [recipe.tone, ...shuffled(recipe, others)]
}

function relativeChromaOf(color: Oklch): number {
  const max = maxSrgbChroma(color.l, color.h)
  return max > 0 ? Math.min(1, color.c / max) : 0
}

function accentAt(recipe: PaletteRecipe, anchor: Anchor, tone: PaletteTone, background: RgbChannels): Oklch | null {
  const spec = ACCENT_TONES[surfaceOf(recipe.base)][tone]
  if (!spec) return null
  const hue = nearestAllowedHue(anchor.hue, recipe.excluded, EXCLUSION_MARGIN, MAX_ACCENT_HUE_SHIFT)
  if (hue === null) return null
  let target: Oklch
  if (tone === 'native') {
    const preferred = recipe.base === 'dark' ? anchor.source.l + NATIVE_DARK_LIGHTNESS_LIFT : anchor.source.l
    const lightness = clamp(preferred + randomBetween(recipe.random, -ACCENT_LIGHTNESS_JITTER, ACCENT_LIGHTNESS_JITTER), spec.lightness)
    const chroma = clamp(anchor.source.c * (1 + randomBetween(recipe.random, -ACCENT_CHROMA_JITTER, ACCENT_CHROMA_JITTER)), NATIVE_ACCENT_CHROMA)
    target = { l: lightness, c: chroma, h: hue }
  } else {
    const lightness = between(recipe, spec.lightness)
    const chroma = Math.min(spec.maxChroma, between(recipe, spec.relativeChroma) * maxSrgbChroma(lightness, hue))
    target = { l: lightness, c: Math.max(ACCENT_MIN_CHROMA, chroma), h: hue }
  }
  return fitLightness(target, background, ACCENT_MIN_CONTRAST, recipe.base === 'dark' ? 'lighter' : 'darker')
}

/** 按最终写出的 sRGB 颜色比较：映射进色域后可能靠近，不能只看映射前的目标色。 */
function shownLab(color: Oklch): Oklab {
  const parsed = parseColor(oklchHex(color))
  return parsed ? rgbToOklab(parsed.channels) : oklchToOklab(color)
}

function nearestAccentDistance(color: Oklch, others: readonly Oklch[]): number {
  const lab = shownLab(color)
  return Math.min(Number.POSITIVE_INFINITY, ...others.map(other => deltaEOK(lab, shownLab(other))))
}

/** 两个颜色的色相差在 OKLab 里的大小（ΔH）：彩度低时，色相差再大也看不出来。 */
function hueDifference(left: Oklch, right: Oklch): number {
  return 2 * Math.sqrt(left.c * right.c) * Math.sin((hueDistance(left.h, right.h) * Math.PI) / 360)
}

function visibleHueDifference(left: Oklch, right: Oklch): number {
  return hueDifference(oklabToOklch(shownLab(left)), oklabToOklch(shownLab(right)))
}

/** 与已有强调色太近时沿明度拉开（先往对比度更安全的方向），仍分不开返回 null。 */
function separated(recipe: PaletteRecipe, color: Oklch, others: readonly Oklch[], background: RgbChannels): Oklch | null {
  if (nearestAccentDistance(color, others) >= ACCENT_MIN_SEPARATION) return color
  const step = between(recipe, ACCENT_TONE_STEP)
  const direction = recipe.base === 'dark' ? 'lighter' : 'darker'
  const shifts = recipe.base === 'dark' ? [step, -step] : [-step, step]
  for (const shift of shifts) {
    const moved = fitLightness({ ...color, l: Math.min(0.97, Math.max(0.12, color.l + shift)) }, background, ACCENT_MIN_CONTRAST, direction)
    if (moved && nearestAccentDistance(moved, others) >= ACCENT_MIN_SEPARATION) return moved
  }
  return null
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

/** 单色相图表：Cubehelix 的思路，明度单调、色相沿途缓慢转动；有一定概率不转，转动会碰到排除区时也不转。 */
function singleHueChart(recipe: PaletteRecipe, hue: number): number[] {
  const drift = recipe.random() < CHART_NO_DRIFT_PROBABILITY ? 0 : (recipe.random() < 0.5 ? -1 : 1) * between(recipe, CHART_HUE_DRIFT)
  const drifted = Array.from({ length: CHART_SERIES_COUNT }, (_, index) => normalizeHue(hue + (drift * index) / (CHART_SERIES_COUNT - 1)))
  return drifted.every(step => isAllowed(recipe, step)) ? drifted : drifted.map(() => hue)
}

/**
 * 多色相图表的色相路径：各色相沿色环排好（不跨最大空档），主色打头，再按明度单调渐变
 * （グラデーション）。渐变经过排除区时改为各色相轮流。
 */
function multiHueChart(recipe: PaletteRecipe, anchors: readonly Anchor[]): number[] {
  const sorted = [...anchors].sort((left, right) => left.hue - right.hue)
  let gapIndex = 0
  let largestGap = -1
  sorted.forEach((anchor, index) => {
    const next = sorted[(index + 1) % sorted.length] ?? anchor
    const gap = normalizeHue(next.hue - anchor.hue) || 360
    if (gap > largestGap) {
      largestGap = gap
      gapIndex = index
    }
  })
  const forwardOrder = [...sorted.slice(gapIndex + 1), ...sorted.slice(0, gapIndex + 1)]
  const first = forwardOrder[0]
  const last = forwardOrder[forwardOrder.length - 1]
  const primary = anchors[0]
  const deepFirst = recipe.base !== 'dark'
  // 主色在一端时放在打头那一档（最显眼）；在中间时，本身更深的一端打头。
  const reverse = last === primary || (first !== primary && first !== undefined && last !== undefined && (deepFirst ? last.source.l < first.source.l : last.source.l > first.source.l))
  const ordered = reverse ? [...forwardOrder].reverse() : forwardOrder
  const segments = ordered.length - 1
  const hues = Array.from({ length: CHART_SERIES_COUNT }, (_, index) => {
    const position = (index / (CHART_SERIES_COUNT - 1)) * segments
    const segment = Math.min(segments - 1, Math.floor(position))
    const from = ordered[segment]?.hue ?? 0
    const to = ordered[segment + 1]?.hue ?? from
    const span = reverse ? -normalizeHue(from - to) : normalizeHue(to - from)
    return normalizeHue(from + span * (position - segment))
  })
  if (hues.every(hue => isAllowed(recipe, hue))) return hues
  return hues.map((_, index) => ordered[index % ordered.length]?.hue ?? 0)
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

/** 灰 + 主色：主色打头，其余是近中性的灰阶，明度单调。 */
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
  const inkRelation = recipe.relation === 'ink'
  // 灰 + 主色要的是近中性的纸，不配本色深底。
  if (inkRelation && ground.key === 'deep') return null
  const primary = pickPrimary(recipe)
  if (!primary) return null
  const anchors = huePlan(recipe, primary)
  if (!anchors) return null
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

  // 强调色：按色相轮流取，色相用完后换下一档色调。
  const count = Math.min(MAX_ACCENT_COUNT, Math.max(1, Math.round(recipe.accentCount ?? DEFAULT_ACCENT_COUNT[recipe.relation])))
  const tones = toneSequence(recipe)
  const accents: Oklch[] = []
  for (let index = 0; index < count; index += 1) {
    const anchor = anchors[index % anchors.length]
    const tone = tones[Math.min(Math.floor(index / anchors.length), tones.length - 1)]
    if (!anchor || !tone) return null
    const raw = accentAt(recipe, anchor, tone, background)
    const accent = raw ? separated(recipe, raw, accents, background) : null
    if (!accent) return null
    accents.push(accent)
  }
  // 第一轮是各色相各一个：彼此要看得出是不同颜色，否则“邻近色”“多色”实际只是一种颜色。
  const firstRound = accents.slice(0, anchors.length)
  if (firstRound.some((accent, index) => firstRound.slice(index + 1).some(other => visibleHueDifference(accent, other) < PARTNER_MIN_HUE_DIFFERENCE))) return null
  const mainAccent = accents[0]
  if (!mainAccent) return null

  let chart: Oklch[]
  if (inkRelation) chart = emphasisChart(recipe, mainAccent, neutralHue, bgColor)
  else {
    const hues = anchors.length === 1 ? singleHueChart(recipe, hue) : multiHueChart(recipe, anchors)
    chart = chartRamp(recipe, mainAccent, hues, chartLightness(recipe, bgColor))
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
