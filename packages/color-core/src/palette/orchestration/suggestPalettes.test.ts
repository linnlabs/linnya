import { describe, expect, it } from 'vitest'

import { deltaEOK, rgbToOklab, rgbToOklch } from '../../functions/colorSpace.js'
import { contrastRatio } from '../../functions/contrast.js'
import { hueDistance } from '../../functions/hue.js'
import { parseColor } from '../../functions/parseColor.js'
import type { Palette, PaletteImagePixels, PaletteSuggestion } from '../definitions/palette.js'
import { ACCENT_MIN_SEPARATION, NEUTRAL_MAX_CHROMA } from '../definitions/paletteConstants.js'
import { isHueExcluded } from '../functions/excludedHues.js'
import { createRandom, decodeRngId, encodeRngId } from '../functions/random.js'
import { paletteFamilies } from '../functions/scorePalette.js'
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
const VERMILION: Rgb = [196, 62, 40]

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

/** 一套配色的色系组合（如 “绿+褐”），用来判断几套是不是一眼看上去同一类颜色。 */
function familySignature(palette: Palette): string {
  return paletteFamilies(palette).sort().join('+')
}

const BRONZE_IMAGES = [
  blocks([[PATINA_GREEN, 50], [MUSEUM_BLACK, 40], [BRONZE, 10]], 64, 6, 1),
  blocks([[BRONZE, 45], [MUSEUM_BLACK, 45], [PATINA_GREEN, 10]], 64, 6, 2),
  blocks([[PATINA_GREEN, 35], [WALL_GRAY, 45], [BRONZE, 20]], 64, 6, 3),
]

/** 主图里有一小块朱红（如器物上的朱砂、标签），面积 2%。 */
const BRONZE_WITH_SPOT_IMAGES = [
  blocks([[PATINA_GREEN, 50], [MUSEUM_BLACK, 38], [BRONZE, 10], [VERMILION, 2]], 64, 6, 1),
  BRONZE_IMAGES[1] ?? blocks([[BRONZE, 1]]),
  BRONZE_IMAGES[2] ?? blocks([[BRONZE, 1]]),
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

  it('面积小但鲜明的颜色作点缀色：进入本色并标出，只做搭配色，不当主色', () => {
    const vermilionHue = rgbToOklch(VERMILION).h
    const first = palettesOf(suggestPalettes({ images: BRONZE_WITH_SPOT_IMAGES, rng: 'pl0006' }))
    const spot = first.subject.find(color => color.spot)
    expect(spot && hueDistance(spot.oklch.h, vermilionHue)).toBeLessThan(10)
    expect(first.subject.filter(color => !color.spot)).toHaveLength(2)
    let usedAsPartner = false
    for (let seed = 0; seed < 50; seed += 1) {
      for (const palette of palettesOf(suggestPalettes({ images: BRONZE_WITH_SPOT_IMAGES, rng: encodeRngId(seed) })).palettes) {
        const main = palette.accent[0]
        if (main) expect(hueDistance(oklchOf(main).h, vermilionHue), `${palette.id} ${main}`).toBeGreaterThan(10)
        if (palette.accent.slice(1).some(hex => hueDistance(oklchOf(hex).h, vermilionHue) < 10)) usedAsPartner = true
      }
    }
    expect(usedAsPartner).toBe(true)
  })

  it('只在一张图里出现的颜色（如主图背景的暗红）只做搭配色，不当主色', () => {
    const backdropRed: Rgb = [92, 40, 36]
    const images = [
      blocks([[LEAF_GREEN, 45], [backdropRed, 35], [WALL_GRAY, 20]], 64, 6, 8),
      blocks([[LEAF_GREEN, 60], [WALL_GRAY, 40]], 64, 6, 9),
      blocks([[LEAF_GREEN, 50], [WALL_GRAY, 50]], 64, 6, 10),
    ]
    const redHue = rgbToOklch(backdropRed).h
    const first = palettesOf(suggestPalettes({ images, rng: 'pl0008' }))
    const red = first.subject.find(color => hueDistance(color.oklch.h, redHue) < 15)
    expect(red?.images).toBe(1)
    for (let seed = 0; seed < 50; seed += 1) {
      for (const palette of palettesOf(suggestPalettes({ images, rng: encodeRngId(seed) })).palettes) {
        const main = palette.accent[0]
        if (main) expect(hueDistance(oklchOf(main).h, redHue), `${palette.id} ${main}`).toBeGreaterThan(15)
      }
    }
  })

  it('每种本色都只在一张图里出现时（主图、显微图、黑白肖像各一张），仍按面积出 3 套，不返回空', () => {
    const leafBrown: Rgb = [140, 103, 92]
    const images = [
      blocks([[leafBrown, 30], [MUSEUM_BLACK, 70]], 64, 6, 11),
      blocks([[LEAF_GREEN, 55], [WALL_GRAY, 45]], 64, 6, 12),
      blocks([[[60, 60, 60], 50], [[210, 210, 208], 50]], 64, 10, 13),
    ]
    for (let seed = 0; seed < 20; seed += 1) {
      const result = palettesOf(suggestPalettes({ images, rng: encodeRngId(seed) }))
      expect(result.subject.every(color => color.images === 1)).toBe(true)
      expect(result.palettes, encodeRngId(seed)).toHaveLength(3)
    }
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
    { images: BRONZE_WITH_SPOT_IMAGES, accentCount: 6 },
    { seedColors: ['#4f813a', '#683833'] },
    { seedColors: ['#77a5c4'], accentCount: 1 },
    { seedColors: ['#c0392b'] },
    { seedColors: ['#e0b000', '#2e5e8c'], accentCount: 5 },
    { images: BRONZE_IMAGES, pinnedColors: ['#1f3a5f'] },
    { images: BRONZE_WITH_SPOT_IMAGES, pinnedColors: ['#c0392b', '#d9a520'], accentCount: 4 },
    { pinnedColors: ['#fecb38'] },
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
        if (input.accentCount === undefined) expect(palette.accent.length).toBeGreaterThanOrEqual(2)
        else expect(palette.accent, `${rng} ${palette.id}`).toHaveLength(input.accentCount)
        const lightness = palette.chart.map(hex => oklchOf(hex).l)
        const steps = lightness.slice(1).map((value, index) => value - (lightness[index] ?? 0))
        const direction = palette.base === 'dark' ? -1 : 1
        expect(steps.every(step => step * direction > 0), `${rng} ${palette.id} ${palette.chart.join(',')}`).toBe(true)
      }
    }
  }, 30_000)

  it('同一次的 3 套是一眼看得出的不同搭配：色系组合各不相同', () => {
    for (const input of [{ images: BRONZE_IMAGES }, { seedColors: ['#77a5c4'] }]) {
      for (let seed = 0; seed < 100; seed += 1) {
        const result = palettesOf(suggestPalettes({ ...input, rng: encodeRngId(seed) }))
        expect(result.palettes).toHaveLength(3)
        const signatures = result.palettes.map(familySignature)
        expect(new Set(signatures).size, `${encodeRngId(seed)} ${signatures.join(' / ')}`).toBe(3)
      }
    }
  }, 30_000)

  it('只要一种底色时，3 套都用它，色系组合仍各不相同', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      const result = palettesOf(suggestPalettes({ images: BRONZE_IMAGES, base: 'dark', rng: encodeRngId(seed) }))
      expect(result.palettes).toHaveLength(3)
      expect(result.palettes.every(palette => palette.base === 'dark')).toBe(true)
      expect(new Set(result.palettes.map(familySignature)).size, encodeRngId(seed)).toBe(3)
    }
  })

  it('多次调用的搭配多样：同样的图 100 次，色系组合超过 12 种；单一色系、灰 + 主色、多色系都有，单一色系不到一半', () => {
    const signatures = new Set<string>()
    const relations = new Set<string>()
    let single = 0
    let multiFamily = 0
    let total = 0
    for (let seed = 0; seed < 100; seed += 1) {
      for (const palette of palettesOf(suggestPalettes({ images: BRONZE_IMAGES, rng: encodeRngId(seed * 31 + 7) })).palettes) {
        signatures.add(familySignature(palette))
        relations.add(palette.relation)
        const families = paletteFamilies(palette).length
        if (families <= 1) single += 1
        if (families >= 3) multiFamily += 1
        total += 1
      }
    }
    expect(signatures.size).toBeGreaterThan(12)
    expect(relations.has('mono') && relations.has('ink')).toBe(true)
    expect(multiFamily).toBeGreaterThan(0)
    expect(single / total).toBeLessThan(0.5)
  })

  it('强调色数量可以指定：1 个就 1 个，6 个时彼此仍分得开', () => {
    const one = palettesOf(suggestPalettes({ images: BRONZE_IMAGES, accentCount: 1, rng: 'pl0007' }))
    expect(one.palettes.every(palette => palette.accent.length === 1)).toBe(true)
    for (let seed = 0; seed < 20; seed += 1) {
      for (const palette of palettesOf(suggestPalettes({ images: BRONZE_WITH_SPOT_IMAGES, accentCount: 6, rng: encodeRngId(seed) })).palettes) {
        expect(palette.accent).toHaveLength(6)
        const labs = palette.accent.map(hex => {
          const parsed = parseColor(hex)
          if (!parsed) throw new Error(`bad hex ${hex}`)
          return rgbToOklab(parsed.channels)
        })
        labs.forEach((lab, index) => labs.slice(index + 1).forEach(other => {
          expect(deltaEOK(lab, other), `${palette.id} ${palette.accent.join(',')}`).toBeGreaterThanOrEqual(ACCENT_MIN_SEPARATION)
        }))
      }
    }
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

describe('用户指定颜色', () => {
  const NAVY = '#1f3a5f'
  const PALE_YELLOW = '#fecb38'

  it('3 套都以指定色为主色，第一个强调色就是原色值，排在本色最前', () => {
    const result = palettesOf(suggestPalettes({ images: BRONZE_IMAGES, pinnedColors: [NAVY.toUpperCase()], rng: 'pl0100' }))
    expect(result.subject[0]).toMatchObject({ hex: NAVY, pinned: true, share: 0, images: 0 })
    expect(result.palettes).toHaveLength(3)
    for (const palette of result.palettes) {
      expect(palette.accent[0]).toBe(NAVY)
      expect(contrast(NAVY, palette.bg)).toBeGreaterThanOrEqual(3)
    }
  })

  it('一次的 3 套仍是不同的色系组合，图片色继续做搭配色', () => {
    let usedImageColor = false
    const patinaHue = rgbToOklch(PATINA_GREEN).h
    for (let seed = 0; seed < 50; seed += 1) {
      const result = palettesOf(suggestPalettes({ images: BRONZE_IMAGES, pinnedColors: [NAVY], rng: encodeRngId(seed) }))
      expect(new Set(result.palettes.map(familySignature)).size, encodeRngId(seed)).toBe(3)
      if (result.palettes.some(palette => palette.accent.slice(1).some(hex => hueDistance(oklchOf(hex).h, patinaHue) < 12))) usedImageColor = true
    }
    expect(usedImageColor).toBe(true)
  })

  it('对比度不够时调底色而不改指定色：浅黄只能配深底', () => {
    for (let seed = 0; seed < 30; seed += 1) {
      for (const palette of palettesOf(suggestPalettes({ pinnedColors: [PALE_YELLOW], rng: encodeRngId(seed) })).palettes) {
        expect(palette.accent[0]).toBe(PALE_YELLOW)
        expect(palette.base).toBe('dark')
      }
    }
  })

  it('要求的底色做不到时返回 pinned_color_conflict，不偷偷改色', () => {
    expect(suggestPalettes({ pinnedColors: [PALE_YELLOW], base: 'light', rng: 'pl0101' }).kind).toBe('pinned_color_conflict')
  })

  it('排除区以指定色为准：图片色在其对侧时丢图片色', () => {
    const magenta = '#8e2a6b'
    const result = palettesOf(suggestPalettes({ images: BRONZE_IMAGES, pinnedColors: [magenta], rng: 'pl0102' }))
    const patinaHue = rgbToOklch(PATINA_GREEN).h
    expect(result.subject.some(color => hueDistance(color.oklch.h, patinaHue) < 15)).toBe(false)
    expect(isHueExcluded(oklchOf(magenta).h, result.excludedHues)).toBe(false)
    for (const palette of result.palettes) expect(palette.accent[0]).toBe(magenta)
  })

  it('多个指定色全部用上且顺序不变；个数多于 accentCount 时不丢', () => {
    const pins = ['#c0392b', '#d9a520', '#1f5fa8']
    for (const palette of palettesOf(suggestPalettes({ pinnedColors: pins, accentCount: 1, rng: 'pl0103' })).palettes) {
      expect(palette.accent.slice(0, 3)).toEqual(pins)
      expect(palette.relation).toBe('multi')
    }
  })

  it('两个指定色互为对侧或 avoid 压到指定色时，仍按用户说的做', () => {
    const opposite = palettesOf(suggestPalettes({ pinnedColors: ['#2e7d32', '#ad1457'], rng: 'pl0104' }))
    expect(opposite.palettes.length).toBeGreaterThan(0)
    for (const palette of opposite.palettes) expect(palette.accent.slice(0, 2)).toEqual(['#2e7d32', '#ad1457'])
    const avoided = palettesOf(suggestPalettes({ pinnedColors: [NAVY], avoidColors: [NAVY], rng: 'pl0105' }))
    for (const palette of avoided.palettes) expect(palette.accent[0]).toBe(NAVY)
  })

  it('黑白灰没有色相，不能当主色；写错的色值报错', () => {
    expect(suggestPalettes({ pinnedColors: ['#222222'] })).toEqual({ kind: 'pinned_color_neutral', hex: '#222222' })
    expect(() => suggestPalettes({ pinnedColors: ['nope'] })).toThrow('Invalid pinned color')
    expect(() => suggestPalettes({ pinnedColors: Array.from({ length: 7 }, () => NAVY) })).toThrow('At most 6')
  })

  it('同一编号结果相同；不指定颜色时结果不受影响', () => {
    const input = { images: BRONZE_IMAGES, pinnedColors: [NAVY], rng: 'pl0106' }
    expect(suggestPalettes(input)).toEqual(suggestPalettes(input))
    expect(palettesOf(suggestPalettes({ images: BRONZE_IMAGES, rng: 'pl0106' })).subject.every(color => !color.pinned)).toBe(true)
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
