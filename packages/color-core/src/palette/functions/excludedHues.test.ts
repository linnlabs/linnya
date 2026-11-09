import { describe, expect, it } from 'vitest'
import { excludedHueRanges, isHueExcluded, nearestAllowedHue } from './excludedHues.js'

describe('排除区', () => {
  it('本色对侧 150°–210°，跨过 0° 的区间保持一段', () => {
    expect(excludedHueRanges([{ l: 0.5, c: 0.08, h: 165 }], [])).toEqual([[315, 15]])
  })

  it('重叠的区间合并，端点保留原值', () => {
    const ranges = excludedHueRanges([{ l: 0.5, c: 0.08, h: 66.4 }, { l: 0.5, c: 0.06, h: 126.2 }], [])
    expect(ranges).toHaveLength(1)
    expect(ranges[0]?.[0]).toBeCloseTo(216.4, 5)
    expect(ranges[0]?.[1]).toBeCloseTo(336.2, 5)
  })

  it('彩度太低的本色不产生排除区；avoid 两侧各 30°', () => {
    expect(excludedHueRanges([{ l: 0.5, c: 0.01, h: 40 }], [])).toEqual([])
    const [range] = excludedHueRanges([], [{ l: 0.6, c: 0.1, h: 100 }])
    expect(isHueExcluded(75, range ? [range] : [])).toBe(true)
    expect(isHueExcluded(135, range ? [range] : [])).toBe(false)
  })

  it('找最近的允许色相，移动过远时放弃', () => {
    expect(nearestAllowedHue(200, [[180, 240]], 6, 40)).toBe(173)
    expect(nearestAllowedHue(210, [[180, 240]], 6, 10)).toBeNull()
  })
})
