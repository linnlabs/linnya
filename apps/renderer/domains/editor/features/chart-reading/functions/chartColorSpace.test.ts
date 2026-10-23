import { describe, expect, it } from 'vitest'
import { oklchToRgb, rgbToOklch, type RgbChannels } from './chartColorSpace'

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
