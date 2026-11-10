import type { Oklch } from '../../definitions/color.js'
import { deltaEOK, oklabToOklch, oklchToOklab, oklchToRgb } from '../../functions/colorSpace.js'
import { hueDistance, normalizeHue } from '../../functions/hue.js'
import { toHex } from '../../functions/parseColor.js'
import { subjectColorName } from '../definitions/hueNames.js'
import type { SubjectColor } from '../definitions/palette.js'
import {
  CHROMATIC_MAX_LIGHTNESS,
  CHROMATIC_MIN_CHROMA,
  CHROMATIC_MIN_LIGHTNESS,
  HUE_FAMILY_RADIUS,
  IMAGE_PRESENCE_MIN_SHARE,
  MAX_NEUTRAL_COLORS,
  MAX_SPOT_COLORS,
  MAX_SUBJECT_COLORS,
  PRIMARY_IMAGE_MIN_WEIGHT,
  PRIMARY_IMAGE_SHARE,
  SECONDARY_SUBJECT_MIN_SCORE_RATIO,
  SINGLE_IMAGE_PENALTY,
  SPOT_MIN_CHROMA,
  SPOT_MIN_SHARE,
  SUBJECT_CHROMA_WEIGHT,
  SUBJECT_MAX_HUE_SPREAD,
  SUBJECT_PRESENCE_WEIGHT,
  SUBJECT_MIN_HUE_SEPARATION,
  SUBJECT_MIN_SHARE,
  SUBJECT_NEAR_HUE_SEPARATION,
  SUBJECT_NEAR_MIN_DELTA_E,
  SUBJECT_SHARE_WEIGHT,
  SUBJECT_TARGET_CHROMA,
} from '../definitions/paletteConstants.js'
import type { QuantizedColor } from './quantizeImage.js'

/**
 * 从多张图的量化结果里找题材本色：低彩度或过暗过亮的颜色只当中性色；彩色按色相聚成族，
 * 记录总占比和出现在几张图里；占比为主、跨图出现次数与接近目标彩度为辅打分，只在一张非主图里出现的降权；
 * 本色最多 4 种，再加最多 2 种面积小但鲜明的点缀色；彼此要看得出是不同颜色，且不落进彼此的对侧。
 */

interface Entry {
  readonly color: Oklch
  readonly weight: number
  readonly image: number
}

interface Family {
  /** 族的种子：最重的那个颜色。归属按种子色相判断，族不会沿色环漂移。 */
  readonly seed: Oklch
  weight: number
  /** 代表色按权重平均明度与彩度（分开平均，不在 a/b 上平均，色相散开时不会发灰）；色相按“权重 × 彩度”求圆形平均。 */
  lightnessSum: number
  chromaSum: number
  hueSin: number
  hueCos: number
  /** 族里“占比 × 彩度”最大的实际颜色：点缀色用它，取的是那一小块最鲜明的颜色，不取平均。 */
  vivid: Oklch
  vividScore: number
  readonly imageWeights: Map<number, number>
}

export interface ExtractedColors {
  readonly subject: readonly SubjectColor[]
  readonly neutrals: readonly string[]
}

function isChromatic(color: Oklch): boolean {
  return color.c >= CHROMATIC_MIN_CHROMA && color.l >= CHROMATIC_MIN_LIGHTNESS && color.l <= CHROMATIC_MAX_LIGHTNESS
}

function addToFamily(family: Family, entry: Entry): void {
  const radians = (entry.color.h * Math.PI) / 180
  const hueWeight = entry.weight * entry.color.c
  family.weight += entry.weight
  family.lightnessSum += entry.color.l * entry.weight
  family.chromaSum += entry.color.c * entry.weight
  family.hueSin += Math.sin(radians) * hueWeight
  family.hueCos += Math.cos(radians) * hueWeight
  if (hueWeight > family.vividScore) {
    family.vivid = entry.color
    family.vividScore = hueWeight
  }
  family.imageWeights.set(entry.image, (family.imageWeights.get(entry.image) ?? 0) + entry.weight)
}

/**
 * 例：光合作用一组里，绿色来自示意图的正绿、温室照片的墨绿和水绵的黄绿；平均下来是自然的叶绿，
 * 而不是示意图里最艳的那块，也不是阴影里的墨绿。
 */
function representativeOf(family: Family): Oklch {
  return {
    l: family.lightnessSum / family.weight,
    c: family.chromaSum / family.weight,
    h: normalizeHue((Math.atan2(family.hueSin, family.hueCos) * 180) / Math.PI),
  }
}

function strongestImageCount(family: Family, imageTotals: readonly number[]): number {
  let count = 0
  family.imageWeights.forEach((weight, image) => {
    const total = imageTotals[image] ?? 0
    if (total > 0 && weight / total >= IMAGE_PRESENCE_MIN_SHARE) count += 1
  })
  return count
}

export function extractSubjectColors(images: readonly (readonly QuantizedColor[])[]): ExtractedColors {
  const chromatic: Entry[] = []
  const neutral: Entry[] = []
  const imageTotals: number[] = []
  const primaryWeight = Math.max(PRIMARY_IMAGE_MIN_WEIGHT, (PRIMARY_IMAGE_SHARE / (1 - PRIMARY_IMAGE_SHARE)) * (images.length - 1))
  images.forEach((colors, image) => {
    const imageWeight = image === 0 ? primaryWeight : 1
    imageTotals[image] = imageWeight
    for (const quantized of colors) {
      const entry = { color: oklabToOklch(quantized.lab), weight: quantized.share * imageWeight, image }
      if (isChromatic(entry.color)) chromatic.push(entry)
      else neutral.push(entry)
    }
  })
  const totalWeight = imageTotals.reduce((sum, weight) => sum + weight, 0)
  if (totalWeight <= 0) return { subject: [], neutrals: [] }

  const families: Family[] = []
  for (const entry of [...chromatic].sort((left, right) => right.weight - left.weight)) {
    const home = families.find(family => hueDistance(family.seed.h, entry.color.h) <= HUE_FAMILY_RADIUS)
    if (home) {
      addToFamily(home, entry)
      continue
    }
    const family: Family = { seed: entry.color, weight: 0, lightnessSum: 0, chromaSum: 0, hueSin: 0, hueCos: 0, vivid: entry.color, vividScore: 0, imageWeights: new Map() }
    addToFamily(family, entry)
    families.push(family)
  }

  const multipleImages = images.length >= 3
  const largestShare = Math.max(0, ...families.map(family => family.weight / totalWeight))
  const presences = families.map(family => strongestImageCount(family, imageTotals))
  const largestPresence = Math.max(1, ...presences)
  const scored = families
    .map((family, familyIndex) => {
      const share = family.weight / totalWeight
      const color = representativeOf(family)
      const presence = presences[familyIndex] ?? 0
      const chromaFit = Math.max(0, 1 - Math.abs(color.c - SUBJECT_TARGET_CHROMA) / SUBJECT_TARGET_CHROMA)
      const onlyOneSecondaryImage = multipleImages && presence < 2 && !family.imageWeights.has(0)
      const score = (SUBJECT_SHARE_WEIGHT * (share / largestShare)
        + SUBJECT_PRESENCE_WEIGHT * (presence / largestPresence)
        + SUBJECT_CHROMA_WEIGHT * chromaFit)
        * (onlyOneSecondaryImage ? SINGLE_IMAGE_PENALTY : 1)
      return { color, share, presence, score, vivid: family.vivid, spot: false }
    })
  const ranked = scored
    .filter(candidate => candidate.share >= SUBJECT_MIN_SHARE)
    .sort((left, right) => right.score - left.score)

  const conflicts = (picked: readonly { readonly color: Oklch }[], color: Oklch) => picked.some(existing => {
    const distance = hueDistance(existing.color.h, color.h)
    if (distance > SUBJECT_MAX_HUE_SPREAD) return true
    if (distance >= SUBJECT_MIN_HUE_SEPARATION) return false
    return distance < SUBJECT_NEAR_HUE_SEPARATION || deltaEOK(oklchToOklab(existing.color), oklchToOklab(color)) < SUBJECT_NEAR_MIN_DELTA_E
  })

  const picked: (typeof scored)[number][] = []
  for (const candidate of ranked) {
    if (picked.length >= MAX_SUBJECT_COLORS) break
    const first = picked[0]
    if (first && candidate.score < first.score * SECONDARY_SUBJECT_MIN_SCORE_RATIO) break
    if (conflicts(picked, candidate.color)) continue
    picked.push(candidate)
  }

  // 点缀色：没选上的族里，按“占比 × 彩度”找面积小但鲜明的颜色，取那一小块最鲜明的实际颜色。
  const spots = scored
    .filter(candidate => !picked.includes(candidate) && candidate.share >= SPOT_MIN_SHARE && candidate.vivid.c >= SPOT_MIN_CHROMA)
    .sort((left, right) => right.share * right.vivid.c - left.share * left.vivid.c)
  for (const candidate of spots) {
    if (picked.filter(item => item.spot).length >= MAX_SPOT_COLORS) break
    if (conflicts(picked, candidate.vivid)) continue
    picked.push({ ...candidate, color: candidate.vivid, spot: true })
  }

  const subject = picked.map(candidate => ({
    hex: toHex(oklchToRgb(candidate.color, { jnd: 0 })),
    name: subjectColorName(candidate.color),
    share: Math.round(candidate.share * 1000) / 1000,
    images: Math.max(1, candidate.presence),
    spot: candidate.spot,
    pinned: false,
    oklch: candidate.color,
  }))

  const neutrals = neutral
    .sort((left, right) => right.weight - left.weight)
    .reduce<Oklch[]>((kept, entry) => {
      if (kept.length < MAX_NEUTRAL_COLORS && kept.every(color => Math.abs(color.l - entry.color.l) > 0.12)) kept.push(entry.color)
      return kept
    }, [])
    .map(color => toHex(oklchToRgb(color, { jnd: 0 })))

  return { subject, neutrals }
}
