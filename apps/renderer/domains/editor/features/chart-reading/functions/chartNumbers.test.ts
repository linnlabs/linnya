import { describe, expect, it } from 'vitest'
import {
  alignScaleToIntervals,
  cleanFloat,
  computeNiceScale,
  formatChartAxisTick,
  formatChartDisplayValue,
  resolveAxisDomain,
} from './chartNumbers'

describe('cleanFloat', () => {
  it('清理浮点噪声并把 -0 归零', () => {
    expect(cleanFloat(0.1 + 0.2)).toBe(0.3)
    expect(Object.is(cleanFloat(-0), 0)).toBe(true)
    expect(cleanFloat(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('computeNiceScale', () => {
  it.each([
    [0, 97, 5, { min: 0, max: 100, interval: 20 }],
    [0, 8, 5, { min: 0, max: 8, interval: 2 }],
    [3, 47, 5, { min: 0, max: 50, interval: 10 }],
    [-12, 31, 5, { min: -20, max: 40, interval: 10 }],
    [0, 0.37, 5, { min: 0, max: 0.4, interval: 0.1 }],
    [120, 134, 5, { min: 120, max: 135, interval: 5 }],
    [0, 1234567, 6, { min: 0, max: 1500000, interval: 500000 }],
  ])('%s..%s（%s 刻度）→ %j', (min, max, ticks, expected) => {
    expect(computeNiceScale(min, max, ticks)).toEqual(expected)
  })

  it('退化范围被展开成可绘制的范围', () => {
    expect(computeNiceScale(0, 0, 5)).toEqual({ min: 0, max: 1, interval: 0.2 })
    const single = computeNiceScale(50, 50, 5)
    expect(single.min).toBeLessThan(50)
    expect(single.max).toBeGreaterThan(50)
  })

  it('拒绝非法范围', () => {
    expect(() => computeNiceScale(Number.NaN, 1, 5)).toThrow(RangeError)
    expect(() => computeNiceScale(2, 1, 5)).toThrow(RangeError)
  })

  it('结果总是覆盖输入范围', () => {
    for (const [min, max] of [[0.13, 0.91], [-7.5, 3.2], [999, 1001], [1e-6, 3e-6], [-1e9, 5e9]]) {
      const scale = computeNiceScale(min, max, 5)
      expect(scale.min).toBeLessThanOrEqual(min)
      expect(scale.max).toBeGreaterThanOrEqual(max)
    }
  })
})

describe('resolveAxisDomain', () => {
  const base = { targetTicks: 5 }

  it('柱/面积轴必含零；折线轴贴合数据', () => {
    expect(resolveAxisDomain({ ...base, dataMin: 12, dataMax: 47, includeZero: true })).toMatchObject({ min: 0, max: 50 })
    expect(resolveAxisDomain({ ...base, dataMin: 101, dataMax: 134, includeZero: false })).toMatchObject({ min: 100, max: 140 })
  })

  it('全负数据的柱轴上端为零', () => {
    expect(resolveAxisDomain({ ...base, dataMin: -40, dataMax: -5, includeZero: true })).toMatchObject({ min: -40, max: 0 })
  })

  it('作者给出的范围与主刻度优先', () => {
    expect(resolveAxisDomain({ ...base, dataMin: 12, dataMax: 47, includeZero: true, userMax: 100 }))
      .toMatchObject({ min: 0, max: 100 })
    expect(resolveAxisDomain({ ...base, dataMin: 12, dataMax: 47, includeZero: true, majorUnit: 25 }))
      .toEqual({ min: 0, max: 50, interval: 25 })
    const both = resolveAxisDomain({ ...base, dataMin: 12, dataMax: 47, includeZero: false, userMin: 0, userMax: 60 })
    expect(both).toMatchObject({ min: 0, max: 60 })
    expect(both.interval).toBeGreaterThan(0)
  })

  it('散点按比例留白，避免边缘点被裁切', () => {
    const domain = resolveAxisDomain({ ...base, dataMin: 1, dataMax: 21, includeZero: false, padRatio: 0.04 })
    expect(domain.min).toBeLessThanOrEqual(0.2)
    expect(domain.max).toBeGreaterThanOrEqual(21.8)
  })
})

describe('数值展示', () => {
  it('作者格式优先；缺省时保留精度并随语言环境分组', () => {
    expect(formatChartDisplayValue(0.256, { numberFormat: '0.0%', locale: 'zh-CN' })).toBe('25.6%')
    expect(formatChartDisplayValue(1234567.891, { locale: 'en-US' })).toBe('1,234,567.891')
    expect(formatChartDisplayValue(0.1 + 0.2, { locale: 'en-US' })).toBe('0.30000000000000004')
  })

  it('坐标轴刻度从千位起紧凑，中文使用万/亿', () => {
    expect(formatChartAxisTick(500, { locale: 'en-US' })).toBe('500')
    expect(formatChartAxisTick(2500, { locale: 'en-US' })).toBe('2.5K')
    expect(formatChartAxisTick(30000, { locale: 'zh-CN' })).toBe('3万')
    expect(formatChartAxisTick(250000000, { locale: 'zh-CN' })).toBe('2.5亿')
    expect(formatChartAxisTick(0.25, { numberFormat: '0%', locale: 'zh-CN' })).toBe('25%')
  })
})

describe('alignScaleToIntervals', () => {
  it('次轴刻度数与主轴一致，使网格线对齐', () => {
    expect(alignScaleToIntervals(0, 0.42, 3, { includeZero: true })).toEqual({ min: 0, max: 0.6, interval: 0.2 })
    expect(alignScaleToIntervals(0, 90, 3, { includeZero: true })).toEqual({ min: 0, max: 150, interval: 50 })
    expect(alignScaleToIntervals(0.27, 0.31, 3, { includeZero: false })).toEqual({ min: 0.26, max: 0.32, interval: 0.02 })
  })

  it('对齐会把数据压扁成一小段时放弃，交给独立的整齐刻度', () => {
    expect(alignScaleToIntervals(0.25, 0.31, 3, { includeZero: false })).toBeNull()
    expect(alignScaleToIntervals(20, 95, 3, { includeZero: false })).toBeNull()
  })

  it('非法输入返回 null', () => {
    expect(alignScaleToIntervals(Number.NaN, 1, 3, { includeZero: false })).toBeNull()
    expect(alignScaleToIntervals(0, 1, 0, { includeZero: false })).toBeNull()
  })
})
