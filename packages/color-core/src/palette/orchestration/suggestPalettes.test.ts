import { describe, expect, it } from 'vitest'

import { rgbToOklch } from '../../functions/colorSpace.js'
import { contrastRatio } from '../../functions/contrast.js'
import { hueDistance } from '../../functions/hue.js'
import { parseColor } from '../../functions/parseColor.js'
import type { Palette, PaletteImagePixels, PaletteSuggestion } from '../definitions/palette.js'
import { NEUTRAL_MAX_CHROMA } from '../definitions/paletteConstants.js'
import { isHueExcluded } from '../functions/excludedHues.js'
import { createRandom, decodeRngId, encodeRngId } from '../functions/random.js'
import { paletteDistance } from '../functions/scorePalette.js'
import { suggestPalettes } from './suggestPalettes.js'

type Rgb = readonly [number, number, number]

/** 按比例铺色块的合成图：每块是一个颜色，占画面相应比例；加一点噪声，像真实照片。 */
function blocks(parts: readonly (readonly [Rgb, number])[], size = 64, noise = 6, seed = 1): PaletteImagePixels {
  const random = createRandom(seed)
  const data = new Uint8Array(size * size * 4)
  const total = parts.reduce((sum, [, share]) => sum + share, 0)
  let pixel = 0
  for (const [color, share] of parts) {
    const count = Math.round((share / total) * size * size)
    for (let i = 0; i < count && pixel < size * size; i += 1, pixel += 1) {
      color.forEach((channel, index) => {
        data[pixel * 4 + index] = Math.max(0, Math.min(255, Math.round(channel + (random() - 0.5) * noise)))
      })
      data[pixel * 4 + 3] = 255
    }
  }
  for (; pixel < size * size; pixel += 1) data[pixel * 4 + 3] = 255
  return { width: size, height: size, data }
}

const LEAF_GREEN: Rgb = [82, 126, 62]
const STAIN_PURPLE: Rgb = [127, 110, 170]
const PATINA_GREEN: Rgb = [89, 114, 100]
const BRONZE: Rgb = [151, 120, 88]
const MUSEUM_BLACK: Rgb = [24, 22, 20]
const WALL_GRAY: Rgb = [200, 200, 198]

function palettesOf(result: ReturnType<typeof suggestPalettes>): PaletteSuggestion {
  if (result.kind !== 'palettes') throw new Error(`expected palettes, got ${result.kind}`)
  return result
}

function oklchOf(hex: string) {
  const parsed = parseColor(hex)
  if (!parsed) throw new Error(`bad hex ${hex}`)
  return rgbToOklch(parsed.channels)
}

function contrast(left: string, right: string): number {
  const a = parseColor(left)
  const b = parseColor(right)
  if (!a || !b) throw new Error('bad hex')
  return contrastRatio(a.channels, b.channels)
}

function colorsOf(palette: Palette): string[] {
  return [palette.bg, palette.surface, palette.ink, palette.muted, ...palette.accent, ...palette.chart]
}

const BRONZE_IMAGES = [
  blocks([[PATINA_GREEN, 50], [MUSEUM_BLACK, 40], [BRONZE, 10]], 64, 6, 1),
  blocks([[BRONZE, 45], [MUSEUM_BLACK, 45], [PATINA_GREEN, 10]], 64, 6, 2),
  blocks([[PATINA_GREEN, 35], [WALL_GRAY, 45], [BRONZE, 20]], 64, 6, 3),
]

describe('取色', () => {
  it('从多张图取到题材本色，背景的黑与灰只算中性色', () => {
    const result = palettesOf(suggestPalettes({ images: BRONZE_IMAGES, rng: 'pl0001' }))
    const hues = result.subject.map(color => color.oklch.h)
    expect(hues.some(hue => hueDistance(hue, rgbToOklch(PATINA_GREEN).h) < 15)).toBe(true)
    expect(hues.some(hue => hueDistance(hue, rgbToOklch(BRONZE).h) < 15)).toBe(true)
    expect(result.subject.every(color => color.images >= 2)).toBe(true)
    expect(result.neutrals.length).toBeGreaterThan(0)
  })

  it('与主本色相距过远的颜色（如切片染色的紫）不选为本色', () => {
    const images = [
      blocks([[LEAF_GREEN, 70], [WALL_GRAY, 30]], 64, 6, 4),
      blocks([[STAIN_PURPLE, 40], [LEAF_GREEN, 30], [WALL_GRAY, 30]], 64, 6, 5),
      blocks([[STAIN_PURPLE, 30], [LEAF_GREEN, 40], [WALL_GRAY, 30]], 64, 6, 6),
    ]
    const result = palettesOf(suggestPalettes({ images, rng: 'pl0002' }))
    expect(result.subject.map(color => hueDistance(color.oklch.h, rgbToOklch(LEAF_GREEN).h)).every(distance => distance <= 120)).toBe(true)
    expect(isHueExcluded(rgbToOklch(STAIN_PURPLE).h, result.excludedHues)).toBe(true)
  })

  it('黑白图、拓片取不出彩色时返回 no_subject_color，不编造颜色', () => {
    const rubbing = blocks([[[30, 30, 30], 55], [[225, 224, 220], 45]], 64, 10, 7)
    expect(suggestPalettes({ images: [rubbing, rubbing] }).kind).toBe('no_subject_color')
  })

  it('没有图片时用种子色作本色', () => {
    const result = palettesOf(suggestPalettes({ seedColors: ['#2f6b57'], rng: 'pl0003' }))
    expect(result.subject[0]?.hex).toBe('#2f6b57')
    expect(result.palettes).toHaveLength(3)
  })
})

describe('出配色', () => {
  const inputs = [
    { images: BRONZE_IMAGES },
    { seedColors: ['#4f813a', '#683833'] },
    { seedColors: ['#77a5c4'] },
    { seedColors: ['#c0392b'] },
    { seedColors: ['#e0b000', '#2e5e8c'] },
  ]

  it('随机 1000 次：任何有彩颜色都不落入排除区，对比度都达标，图表按明度单调', () => {
    const random = createRandom(42)
    for (let run = 0; run < 1000; run += 1) {
      const input = inputs[run % inputs.length] ?? {}
      const rng = encodeRngId(Math.floor(random() * 36 ** 4))
      const result = palettesOf(suggestPalettes({ ...input, rng }))
      for (const palette of result.palettes) {
        for (const hex of colorsOf(palette)) {
          const color = oklchOf(hex)
          if (color.c >= NEUTRAL_MAX_CHROMA) expect(isHueExcluded(color.h, result.excludedHues), `${rng} ${palette.id} ${hex}`).toBe(false)
        }
        expect(contrast(palette.ink, palette.bg)).toBeGreaterThanOrEqual(7)
        expect(contrast(palette.muted, palette.bg)).toBeGreaterThanOrEqual(4.5)
        for (const accent of palette.accent) expect(contrast(accent, palette.bg)).toBeGreaterThanOrEqual(3)
        const lightness = palette.chart.map(hex => oklchOf(hex).l)
        const steps = lightness.slice(1).map((value, index) => value - (lightness[index] ?? 0))
        const direction = palette.base === 'dark' ? -1 : 1
        expect(steps.every(step => step * direction > 0), `${rng} ${palette.id} ${palette.chart.join(',')}`).toBe(true)
      }
    }
  })

  it('同一次的 3 套两两明显不同（角色加权 ΔEOK 加结构差异 ≥ 0.09）', () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const result = palettesOf(suggestPalettes({ images: BRONZE_IMAGES, rng: encodeRngId(seed) }))
      expect(result.palettes).toHaveLength(3)
      const [a, b, c] = result.palettes
      if (!a || !b || !c) throw new Error('missing palette')
      for (const [left, right] of [[a, b], [a, c], [b, c]] as const) expect(paletteDistance(left, right), encodeRngId(seed)).toBeGreaterThanOrEqual(0.09)
    }
  })

  it('只要一种底色时，3 套都用它，彼此仍不同', () => {
    const result = palettesOf(suggestPalettes({ images: BRONZE_IMAGES, base: 'dark', rng: 'pl00a0' }))
    expect(result.palettes).toHaveLength(3)
    expect(result.palettes.every(palette => palette.base === 'dark')).toBe(true)
    const [a, b, c] = result.palettes
    if (!a || !b || !c) throw new Error('missing palette')
    for (const [left, right] of [[a, b], [a, c], [b, c]] as const) expect(paletteDistance(left, right)).toBeGreaterThanOrEqual(0.06)
  })

  it('每次不同是看得出的不同：同样的图调用 100 次，可区分的配色（角色加权距离 ≥ 0.05）超过 40 种', () => {
    const representatives: Palette[] = []
    for (let seed = 0; seed < 100; seed += 1) {
      for (const palette of palettesOf(suggestPalettes({ images: BRONZE_IMAGES, rng: encodeRngId(seed * 31 + 7) })).palettes) {
        if (representatives.every(existing => paletteDistance(existing, palette) >= 0.05)) representatives.push(palette)
      }
    }
    expect(representatives.length).toBeGreaterThan(40)
  })

  it('avoid 的颜色两侧不出现', () => {
    const result = palettesOf(suggestPalettes({ seedColors: ['#4f813a'], avoidColors: ['#c8a000'], rng: 'pl0004' }))
    const avoidHue = oklchOf('#c8a000').h
    for (const palette of result.palettes) {
      for (const hex of colorsOf(palette)) {
        const color = oklchOf(hex)
        if (color.c >= NEUTRAL_MAX_CHROMA) expect(hueDistance(color.h, avoidHue)).toBeGreaterThan(30)
      }
    }
  })
})

describe('每次不同与可复现', () => {
  it('同样输入加同一编号，结果完全相同；编号写在结果里', () => {
    const first = suggestPalettes({ images: BRONZE_IMAGES, rng: 'pl8f2a' })
    const second = suggestPalettes({ images: BRONZE_IMAGES, rng: 'pl8f2a' })
    expect(second).toEqual(first)
    expect(palettesOf(first).id).toBe('pl8f2a')
    expect(palettesOf(first).palettes[0]?.id).toBe('pl8f2a-1')
  })

  it('不传编号时连续 10 次，没有一次与上一次完全相同', () => {
    let previous = ''
    for (let run = 0; run < 10; run += 1) {
      const current = JSON.stringify(palettesOf(suggestPalettes({ images: BRONZE_IMAGES })).palettes.map(palette => ({ ...palette, id: '' })))
      expect(current).not.toBe(previous)
      previous = current
    }
  })

  it('编号可以往返解析，不认识的编号报错', () => {
    expect(decodeRngId(encodeRngId(12345))).toBe(12345)
    expect(decodeRngId('nope')).toBeNull()
    expect(() => suggestPalettes({ seedColors: ['#4f813a'], rng: 'nope' })).toThrow('Unknown palette id')
  })
})

describe('性能', () => {
  it('10 张 128 px 的图取色加出配色在 500 ms 内', () => {
    const images = Array.from({ length: 10 }, (_, index) => blocks([[LEAF_GREEN, 40], [BRONZE, 20], [WALL_GRAY, 40]], 128, 40, index + 10))
    const started = performance.now()
    palettesOf(suggestPalettes({ images, rng: 'pl0005' }))
    expect(performance.now() - started).toBeLessThan(500)
  })
})
