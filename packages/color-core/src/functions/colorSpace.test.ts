import { describe, expect, it } from 'vitest'
import { deltaEOK, isLinearRgbInGamut, maxSrgbChroma, oklabToLinearRgb, oklchToOklab, oklchToRgb, rgbToOklab, rgbToOklch, type RgbChannels } from './colorSpace.js'

describe('sRGB ↔ OKLCH', () => {
  it('已知值：黑、白、中性灰没有彩度，红的色相在 29° 附近', () => {
    expect(rgbToOklch([0, 0, 0]).l).toBeCloseTo(0, 5)
    expect(rgbToOklch([255, 255, 255]).l).toBeCloseTo(1, 3)
    expect(rgbToOklch([128, 128, 128]).c).toBeLessThan(0.001)
    const red = rgbToOklch([255, 0, 0])
    expect(red.l).toBeCloseTo(0.628, 2)
    expect(red.c).toBeCloseTo(0.258, 2)
    expect(red.h).toBeCloseTo(29.2, 0)
  })

  it('往返误差不超过 1 个通道值：低饱和的色板颜色不会因为转换而走样', () => {
    const samples: RgbChannels[] = [
      [70, 110, 78], [243, 234, 189], [114, 168, 139], [211, 246, 234],
      [72, 94, 132], [171, 213, 238], [202, 131, 122], [12, 200, 90],
    ]
    for (const sample of samples) {
      const back = oklchToRgb(rgbToOklch(sample))
      back.forEach((channel, index) => expect(Math.abs(channel - (sample[index] ?? 0))).toBeLessThanOrEqual(1))
    }
  })

  it('超出色域的颜色压缩彩度而不是截断通道：明度与色相基本不变，通道都在 0–255', () => {
    const wanted = { l: 0.7, c: 0.35, h: 150 }
    const rgb = oklchToRgb(wanted)
    rgb.forEach(channel => {
      expect(channel).toBeGreaterThanOrEqual(0)
      expect(channel).toBeLessThanOrEqual(255)
    })
    const actual = rgbToOklch(rgb)
    expect(actual.c).toBeLessThan(wanted.c)
    expect(actual.l).toBeCloseTo(wanted.l, 1)
    expect(Math.abs(actual.h - wanted.h)).toBeLessThan(4)
  })

  it('负彩度按零处理，得到对应明度的灰', () => {
    const [red, green, blue] = oklchToRgb({ l: 0.5, c: -0.2, h: 40 })
    expect(Math.abs(red - green)).toBeLessThan(1)
    expect(Math.abs(green - blue)).toBeLessThan(1)
  })
})

describe('CSS Color 4 色域映射', () => {
  it('色域内的颜色原样换算，明度 ≥ 1 与 ≤ 0 给白与黑', () => {
    const inside = { l: 0.6, c: 0.05, h: 140 }
    const back = rgbToOklch(oklchToRgb(inside))
    expect(back.l).toBeCloseTo(inside.l, 3)
    expect(back.c).toBeCloseTo(inside.c, 3)
    expect(oklchToRgb({ l: 1.2, c: 0.1, h: 20 })).toEqual([255, 255, 255])
    expect(oklchToRgb({ l: -0.1, c: 0.1, h: 20 })).toEqual([0, 0, 0])
  })

  it('默认按 CSS Color 4：彩度降低、明度基本不变、通道在 0–255', () => {
    for (const h of [30, 90, 145, 200, 265, 330]) {
      for (const l of [0.3, 0.55, 0.8]) {
        const rgb = oklchToRgb({ l, c: 0.3, h })
        rgb.forEach(channel => expect(channel >= 0 && channel <= 255).toBe(true))
        const actual = rgbToOklch(rgb)
        expect(actual.c).toBeLessThan(0.3)
        expect(Math.abs(actual.l - l)).toBeLessThan(0.03)
      }
    }
  })

  it('jnd 为 0 时只降彩度：明度与色相严格不变（暗黄这类色相也不偏）', () => {
    for (const h of [30, 90, 145, 200, 265, 330]) {
      for (const l of [0.3, 0.55, 0.8]) {
        const actual = rgbToOklch(oklchToRgb({ l, c: 0.3, h }, { jnd: 0 }))
        expect(Math.abs(actual.l - l)).toBeLessThan(0.002)
        expect(Math.min(Math.abs(actual.h - h), 360 - Math.abs(actual.h - h))).toBeLessThan(0.5)
      }
    }
  })
})

describe('sRGB 最大彩度', () => {
  it('黑白处为 0；同明度下蓝紫能到的彩度远高于黄绿以外的青；结果在色域边界上', () => {
    expect(maxSrgbChroma(0, 120)).toBe(0)
    expect(maxSrgbChroma(1, 120)).toBe(0)
    const blue = maxSrgbChroma(0.45, 264)
    const cyan = maxSrgbChroma(0.45, 200)
    expect(blue).toBeGreaterThan(cyan * 2)
    for (const [l, h] of [[0.3, 30], [0.6, 145], [0.9, 110], [0.45, 264]] as const) {
      const max = maxSrgbChroma(l, h)
      expect(isLinearRgbInGamut(oklabToLinearRgb(oklchToOklab({ l, c: max, h })))).toBe(true)
      expect(isLinearRgbInGamut(oklabToLinearRgb(oklchToOklab({ l, c: max + 0.002, h })))).toBe(false)
    }
  })
})

describe('ΔEOK', () => {
  it('相同颜色为 0，黑白之间约为 1', () => {
    const white = rgbToOklab([255, 255, 255])
    expect(deltaEOK(white, white)).toBe(0)
    expect(deltaEOK(white, rgbToOklab([0, 0, 0]))).toBeCloseTo(1, 2)
  })
})
