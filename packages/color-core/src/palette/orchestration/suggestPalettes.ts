import type { Oklch } from '../../definitions/color.js'
import { rgbToOklch } from '../../functions/colorSpace.js'
import { hueDistance } from '../../functions/hue.js'
import { parseColor } from '../../functions/parseColor.js'
import { subjectColorName } from '../definitions/hueNames.js'
import type {
  Palette,
  PaletteBase,
  PaletteFailure,
  PaletteRelation,
  PaletteSuggestion,
  SubjectColor,
  SuggestPalettesInput,
} from '../definitions/palette.js'
import {
  COMBINATION_WEIGHTS,
  DEFAULT_PALETTE_COUNT,
  MAX_PALETTE_COUNT,
  SUBJECT_MIN_HUE_SEPARATION,
} from '../definitions/paletteConstants.js'
import { buildPalette } from '../functions/buildPalette.js'
import { excludedHueRanges, isHueExcluded } from '../functions/excludedHues.js'
import { extractSubjectColors } from '../functions/extractSubjectColors.js'
import { quantizeImage } from '../functions/quantizeImage.js'
import { createRandom, decodeRngId, encodeRngId, freshSeed, type RandomSource } from '../functions/random.js'

/** 一次最多处理的图片数。 */
export const MAX_PALETTE_IMAGES = 20

const RELATIONS: readonly PaletteRelation[] = ['mono', 'analog', 'ink', 'dual']
const BASES: readonly PaletteBase[] = ['light', 'tint', 'dark']
const ATTEMPTS_PER_COMBINATION = 3

interface Combination {
  readonly relation: PaletteRelation
  readonly base: PaletteBase
  readonly weight: number
}

function parseOklch(hex: string): Oklch | null {
  const parsed = parseColor(hex)
  return parsed ? rgbToOklch(parsed.channels) : null
}

function seedSubject(color: Oklch, hex: string): SubjectColor {
  return { hex, name: subjectColorName(color), share: 0, images: 0, oklch: color }
}

function pickWeighted(combinations: readonly Combination[], random: RandomSource): Combination | null {
  const total = combinations.reduce((sum, combination) => sum + combination.weight, 0)
  if (total <= 0) return null
  let target = random() * total
  for (const combination of combinations) {
    target -= combination.weight
    if (target <= 0) return combination
  }
  return combinations[combinations.length - 1] ?? null
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

  const extracted = extractSubjectColors(images.map(image => quantizeImage(image)))
  const subject: SubjectColor[] = [...extracted.subject]
  for (const hex of input.seedColors ?? []) {
    const color = parseOklch(hex)
    if (!color) continue
    if (subject.some(existing => hueDistance(existing.oklch.h, color.h) < SUBJECT_MIN_HUE_SEPARATION)) continue
    subject.push(seedSubject(color, hex.toLowerCase()))
  }
  if (subject.length === 0) return { kind: 'no_subject_color' }

  const avoid = (input.avoidColors ?? []).map(parseOklch).filter((color): color is Oklch => color !== null)
  const excluded = excludedHueRanges(subject.map(color => color.oklch), avoid)
  const subjectColors = subject.map(color => color.oklch)
  const secondary = subjectColors[1]
  const dualAvailable = secondary !== undefined && !isHueExcluded(secondary.h, excluded)

  const combinations: Combination[] = RELATIONS
    .filter(relation => relation !== 'dual' || dualAvailable)
    .flatMap(relation => BASES
      .filter(base => input.base === undefined || base === input.base)
      .map(base => ({ relation, base, weight: COMBINATION_WEIGHTS[relation][base] })))

  // 分档抽取：先在关系与底色都没用过的组合里抽，抽不到再放宽到至少一项不同；同档内按先验权重随机。
  const palettes: Palette[] = []
  const remaining = [...combinations]
  while (palettes.length < count && remaining.length > 0) {
    const usedRelations = new Set(palettes.map(palette => palette.relation))
    const usedBases = new Set(palettes.map(palette => palette.base))
    const tiers = [
      remaining.filter(candidate => !usedRelations.has(candidate.relation) && !usedBases.has(candidate.base)),
      remaining.filter(candidate => !usedRelations.has(candidate.relation) || !usedBases.has(candidate.base)),
    ]
    const tier = tiers.find(candidates => candidates.length > 0)
    if (!tier) break
    const combination = pickWeighted(tier, random)
    if (!combination) break
    remaining.splice(remaining.indexOf(combination), 1)
    let palette: Palette | null = null
    for (let attempt = 0; attempt < ATTEMPTS_PER_COMBINATION && !palette; attempt += 1) {
      palette = buildPalette({
        id: `${id}-${palettes.length + 1}`,
        relation: combination.relation,
        base: combination.base,
        subject: subjectColors,
        excluded,
        random,
      })
    }
    if (palette) palettes.push(palette)
  }

  return { kind: 'palettes', id, subject, neutrals: extracted.neutrals, excludedHues: excluded, palettes }
}
