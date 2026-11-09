import type { Oklch } from '../../definitions/color.js'
import { rgbToOklch } from '../../functions/colorSpace.js'
import { hueDistance } from '../../functions/hue.js'
import { parseColor, toHex } from '../../functions/parseColor.js'
import { subjectColorName } from '../definitions/hueNames.js'
import type {
  Palette,
  PaletteBase,
  PaletteFailure,
  PaletteRelation,
  PaletteSuggestion,
  PaletteTone,
  SubjectColor,
  SuggestPalettesInput,
} from '../definitions/palette.js'
import {
  ACCENT_TONES,
  CANDIDATE_COUNT,
  DEFAULT_PALETTE_COUNT,
  GROUND_VARIANTS,
  type GroundVariant,
  MAX_PALETTE_COUNT,
  MIN_PALETTE_DISTANCES,
  MAX_ACCENT_COUNT,
  MAX_PINNED_COLORS,
  MULTI_MIN_SUBJECTS,
  NEUTRAL_MAX_CHROMA,
  PRIMARY_MIN_IMAGES_FOR_PRESENCE,
  QUALITY_BAND,
  RELATION_HUE_SHIFT,
  RELATION_WEIGHTS,
  SUBJECT_MAX_HUE_SPREAD,
  SUBJECT_MIN_HUE_SEPARATION,
} from '../definitions/paletteConstants.js'
import { buildPalette } from '../functions/buildPalette.js'
import { excludedHueRanges, isHueExcluded, withoutPinnedHues } from '../functions/excludedHues.js'
import { extractSubjectColors } from '../functions/extractSubjectColors.js'
import { quantizeImage } from '../functions/quantizeImage.js'
import { createRandom, decodeRngId, encodeRngId, freshSeed, type RandomSource } from '../functions/random.js'
import { paletteColors, paletteDistance, type PaletteColors, scorePalette } from '../functions/scorePalette.js'

/** 一次最多处理的图片数。 */
export const MAX_PALETTE_IMAGES = 20

const RELATIONS: readonly PaletteRelation[] = ['mono', 'ink', 'analog', 'medium', 'contrast', 'multi']
const BASES: readonly PaletteBase[] = ['light', 'tint', 'dark']

/** 风格基因里离散的那几维；其余连续取值在 buildPalette 里按同一随机源采样。 */
interface Style {
  readonly relation: PaletteRelation
  readonly base: PaletteBase
  readonly ground: GroundVariant
  readonly tone: PaletteTone
  readonly weight: number
}

interface Candidate {
  readonly palette: Palette
  readonly colors: PaletteColors
  readonly quality: number
}

function parseOklch(hex: string): Oklch | null {
  const parsed = parseColor(hex)
  return parsed ? rgbToOklch(parsed.channels) : null
}

function seedSubject(color: Oklch, hex: string): SubjectColor {
  return { hex, name: subjectColorName(color), share: 0, images: 0, spot: false, pinned: false, oklch: color }
}

function parsePinnedColors(hexes: readonly string[]): SubjectColor[] {
  if (hexes.length > MAX_PINNED_COLORS) throw new RangeError(`At most ${MAX_PINNED_COLORS} pinned colors are accepted`)
  return hexes.map(hex => {
    const parsed = parseColor(hex)
    if (!parsed) throw new RangeError(`Invalid pinned color: ${hex}`)
    return { ...seedSubject(rgbToOklch(parsed.channels), toHex(parsed.channels)), pinned: true }
  })
}

/** 两个以上指定色时色相就定了，关系由它们的色相差决定，不再采样。 */
function relationOfPinned(pinned: readonly SubjectColor[]): PaletteRelation {
  const [first, second] = pinned
  if (!first || !second || pinned.length > 2) return 'multi'
  const distance = hueDistance(first.oklch.h, second.oklch.h)
  if (distance <= RELATION_HUE_SHIFT.analog.max) return 'analog'
  return distance <= RELATION_HUE_SHIFT.medium.max ? 'medium' : 'contrast'
}

function pickWeighted<T>(items: readonly T[], weightOf: (item: T) => number, random: RandomSource): T | null {
  const total = items.reduce((sum, item) => sum + weightOf(item), 0)
  if (total <= 0) return null
  let target = random() * total
  for (const item of items) {
    target -= weightOf(item)
    if (target <= 0) return item
  }
  return items[items.length - 1] ?? null
}

/** 把离散维度的全部组合列出来，权重 = 关系 × 底色 × 底面变体 × 色调的先验之积。 */
function styleSpace(relations: readonly PaletteRelation[], bases: readonly PaletteBase[]): Style[] {
  return relations.flatMap(relation => bases.flatMap(base => GROUND_VARIANTS[base].flatMap(ground => {
    const tones = Object.entries(ACCENT_TONES[base === 'dark' ? 'dark' : 'paper']) as [PaletteTone, { readonly weight: number }][]
    return tones.map(([tone, spec]) => ({ relation, base, ground, tone, weight: RELATION_WEIGHTS[relation][base] * ground.weight * spec.weight }))
  })))
}

/**
 * 按差异挑选：第一套在高分段里按分数加权抽；之后每套必须与已选各套的感知距离不低于门槛（门槛从高到低放宽），
 * 满足门槛的候选里优先没用过的关系，再按分数加权抽。这样每套都好，彼此又尽量不同。
 */
function selectDiverse(candidates: readonly Candidate[], count: number, random: RandomSource): Candidate[] {
  const picked: Candidate[] = []
  const nearest = candidates.map(() => Number.POSITIVE_INFINITY)
  while (picked.length < count) {
    let eligible: number[] = []
    for (const threshold of MIN_PALETTE_DISTANCES) {
      eligible = candidates.map((_, index) => index).filter(index => !picked.includes(candidates[index] as Candidate) && (nearest[index] ?? 0) >= threshold)
      if (eligible.length > 0) break
    }
    if (eligible.length === 0) break
    const usedRelations = new Set(picked.map(candidate => candidate.palette.relation))
    const freshRelation = eligible.filter(index => !usedRelations.has(candidates[index]?.palette.relation ?? 'mono'))
    if (freshRelation.length > 0) eligible = freshRelation
    const best = Math.max(...eligible.map(index => candidates[index]?.quality ?? 0))
    const band = eligible.filter(index => (candidates[index]?.quality ?? 0) >= best * QUALITY_BAND)
    const chosenIndex = pickWeighted(band, index => candidates[index]?.quality ?? 0, random)
    const chosen = chosenIndex === null ? undefined : candidates[chosenIndex]
    if (!chosen) break
    picked.push(chosen)
    candidates.forEach((candidate, index) => {
      if (picked.includes(candidate)) return
      nearest[index] = Math.min(nearest[index] ?? Number.POSITIVE_INFINITY, paletteDistance(candidate.palette, chosen.palette, candidate.colors, chosen.colors))
    })
  }
  return picked
}

/**
 * 取色 + 出配色。`rng` 给出之前的编号时结果逐字节相同；取色本身是确定的，随机只用在选组合与微调上。
 */
export function suggestPalettes(input: SuggestPalettesInput): PaletteSuggestion | PaletteFailure {
  const images = input.images ?? []
  if (images.length > MAX_PALETTE_IMAGES) throw new RangeError(`At most ${MAX_PALETTE_IMAGES} images are accepted`)
  const decoded = input.rng === undefined ? null : decodeRngId(input.rng)
  if (input.rng !== undefined && decoded === null) throw new RangeError(`Unknown palette id: ${input.rng}`)
  const seed = decoded ?? freshSeed()
  const id = encodeRngId(seed)
  const random = createRandom(seed)
  const count = Math.min(MAX_PALETTE_COUNT, Math.max(1, Math.round(input.count ?? DEFAULT_PALETTE_COUNT)))

  const pinned = parsePinnedColors(input.pinnedColors ?? [])
  const neutralPin = pinned.find(color => color.oklch.c < NEUTRAL_MAX_CHROMA)
  if (neutralPin) return { kind: 'pinned_color_neutral', hex: neutralPin.hex }

  const extracted = extractSubjectColors(images.map(image => quantizeImage(image)))
  const found: SubjectColor[] = [...extracted.subject]
  for (const hex of input.seedColors ?? []) {
    const color = parseOklch(hex)
    if (!color) continue
    if (found.some(existing => hueDistance(existing.oklch.h, color.h) < SUBJECT_MIN_HUE_SEPARATION)) continue
    found.push(seedSubject(color, hex.toLowerCase()))
  }
  // 指定色优先：落在它对侧的图片色不要，其余图片色仍可做搭配色。
  const compatible = found.filter(color => !pinned.some(pin => hueDistance(pin.oklch.h, color.oklch.h) > SUBJECT_MAX_HUE_SPREAD))
  const subject: SubjectColor[] = [...pinned, ...compatible]
  if (subject.length === 0) return { kind: 'no_subject_color' }

  const avoid = (input.avoidColors ?? []).map(parseOklch).filter((color): color is Oklch => color !== null)
  const excluded = withoutPinnedHues(excludedHueRanges(subject.map(color => color.oklch), avoid), pinned.map(color => color.oklch.h))
  const subjectColors = subject.map(color => color.oklch)
  const partnerOnly = subject.map(color => color.spot || (images.length >= PRIMARY_MIN_IMAGES_FOR_PRESENCE && color.images > 0 && color.images < 2))
  const multiAvailable = subjectColors.filter(color => !isHueExcluded(color.h, excluded)).length >= MULTI_MIN_SUBJECTS
  const accentCount = input.accentCount === undefined ? undefined : Math.min(MAX_ACCENT_COUNT, Math.max(1, Math.round(input.accentCount)))

  const pinnedHexes = pinned.map(color => color.hex)
  const styles = styleSpace(
    pinned.length >= 2 ? [relationOfPinned(pinned)] : RELATIONS.filter(relation => relation !== 'multi' || multiAvailable),
    BASES.filter(base => input.base === undefined || base === input.base),
  )

  // 先采样一批候选：离散维度按先验权重抽（先验只决定出现频率，不进分数），连续维度在 buildPalette 里取；
  // 做不出（对比度、排除区）的丢掉。
  const candidates: Candidate[] = []
  for (let attempt = 0; attempt < CANDIDATE_COUNT; attempt += 1) {
    const style = pickWeighted(styles, item => item.weight, random)
    if (!style) break
    const palette = buildPalette({ id, relation: style.relation, base: style.base, ground: style.ground, tone: style.tone, subject: subjectColors, partnerOnly, excluded, random, accentCount, pinnedHexes })
    if (!palette) continue
    const colors = paletteColors(palette)
    candidates.push({ palette, colors, quality: scorePalette(palette, colors) })
  }

  const palettes: Palette[] = selectDiverse(candidates, count, random).map((candidate, index) => ({ ...candidate.palette, id: `${id}-${index + 1}` }))
  if (pinned.length > 0 && palettes.length === 0) return { kind: 'pinned_color_conflict' }

  return { kind: 'palettes', id, subject, neutrals: extracted.neutrals, excludedHues: excluded, palettes }
}
