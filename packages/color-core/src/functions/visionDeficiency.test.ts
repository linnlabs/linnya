import { describe, expect, it } from 'vitest'
import { deltaEOK, rgbToOklab } from './colorSpace.js'
import { simulateColorVisionDeficiency } from './visionDeficiency.js'

describe('色觉异常模拟', () => {
  it('黑白灰基本不变', () => {
    for (const kind of ['protanopia', 'deuteranopia', 'tritanopia'] as const) {
      for (const gray of [0, 128, 255]) {
        const simulated = simulateColorVisionDeficiency([gray, gray, gray], kind)
        simulated.forEach(channel => expect(Math.abs(channel - gray)).toBeLessThan(2))
      }
    }
  })

  it('红绿色盲下，明度相近的红与绿几乎分不开，明度拉开后仍可区分', () => {
    const red: [number, number, number] = [200, 80, 60]
    const green: [number, number, number] = [110, 140, 60]
    const darkGreen: [number, number, number] = [40, 70, 30]
    const seen = (rgb: [number, number, number]) => rgbToOklab(simulateColorVisionDeficiency(rgb, 'deuteranopia'))
    expect(deltaEOK(rgbToOklab(red), rgbToOklab(green))).toBeGreaterThan(0.15)
    expect(deltaEOK(seen(red), seen(green))).toBeLessThan(0.06)
    expect(deltaEOK(seen(red), seen(darkGreen))).toBeGreaterThan(0.2)
  })
})
