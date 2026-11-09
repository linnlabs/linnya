import { describe, expect, it } from 'vitest'
import { hueDistance, isHueWithinArc, normalizeHue } from './hue.js'

describe('色相', () => {
  it('归一与最短距离跨过 0°', () => {
    expect(normalizeHue(-30)).toBe(330)
    expect(normalizeHue(390)).toBe(30)
    expect(hueDistance(350, 10)).toBe(20)
    expect(hueDistance(0, 180)).toBe(180)
  })

  it('顺时针弧可以跨过 0°', () => {
    expect(isHueWithinArc(5, 315, 15)).toBe(true)
    expect(isHueWithinArc(300, 315, 15)).toBe(false)
    expect(isHueWithinArc(250, 225, 285)).toBe(true)
  })
})
