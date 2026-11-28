import { describe, expect, it } from 'vitest'
import { rgbToCielab } from './cielab.js'

describe('rgbToCielab', () => {
  it('与 CIE 1976（D65）的参考值一致：白、黑无彩，纯红落在常见的参考坐标', () => {
    const white = rgbToCielab([255, 255, 255])
    expect(white.l).toBeCloseTo(100, 3)
    // IEC 61966-2-1 的 4 位小数矩阵让白点残留约 0.012 的彩度，远小于去背用的色差阈值 9
    expect(Math.hypot(white.a, white.b)).toBeLessThan(0.02)
    expect(rgbToCielab([0, 0, 0])).toEqual({ l: 0, a: 0, b: 0 })
    const red = rgbToCielab([255, 0, 0])
    expect(red.l).toBeCloseTo(53.24, 1)
    expect(red.a).toBeCloseTo(80.09, 1)
    expect(red.b).toBeCloseTo(67.20, 1)
  })
})
