import { describe, expect, it } from 'vitest'

import { rgbToOklch } from '../../functions/colorSpace.js'
import { contrastRatio } from '../../functions/contrast.js'
import { parseColor } from '../../functions/parseColor.js'
import type { HueRange, PaletteDraft } from '../definitions/palette.js'
import { suggestPalettes } from '../orchestration/suggestPalettes.js'
import { checkPalette } from './checkPalette.js'
import { isHueExcluded } from './excludedHues.js'

function channels(hex: string) {
  const parsed = parseColor(hex)
  if (!parsed) throw new Error(`bad hex ${hex}`)
  return parsed.channels
}

const contrast = (left: string, right: string) => contrastRatio(channels(left), channels(right))
const oklch = (hex: string) => rgbToOklch(channels(hex))

const GOOD: PaletteDraft = {
  bg: '#f7f7f5',
  surface: '#ecece8',
  ink: '#1a1a1a',
  muted: '#5e5e5a',
  accent: ['#2f6b57', '#8a5a2b'],
  chart: ['#2f6b57', '#6f9a86', '#a9c4b6', '#c8d8ce'],
}

describe('checkPalette', () => {
  it('合格的配色没有问题，也不给改动', () => {
    expect(checkPalette({ palette: GOOD })).toEqual({ ok: true, findings: [], suggested: null })
  })

  it('算法生成的配色用同一把尺子查都合格', () => {
    for (const rng of ['pl0001', 'pl0002', 'pl0003']) {
      const result = suggestPalettes({ seedColors: ['#4f813a', '#683833'], rng })
      if (result.kind !== 'palettes') throw new Error(result.kind)
      for (const palette of result.palettes) expect(checkPalette({ palette, excludedHues: result.excludedHues }).findings).toEqual([])
    }
  })

  it('对比度不够：报实测值，建议只调明度，其余角色不动', () => {
    const result = checkPalette({ palette: { ...GOOD, accent: ['#c8d8ce', '#8a5a2b'] } })
    expect(result.ok).toBe(false)
    expect(result.findings).toEqual([expect.objectContaining({ rule: 'accent_contrast', role: 'accent[0]', value: '#c8d8ce', required: 3 })])
    const suggested = result.suggested
    if (!suggested?.accent[0]) throw new Error('expected a suggestion')
    expect(contrast(suggested.accent[0], GOOD.bg)).toBeGreaterThanOrEqual(3)
    expect(Math.abs(oklch(suggested.accent[0]).h - oklch('#c8d8ce').h)).toBeLessThan(6)
    expect({ ...suggested, accent: [] }).toEqual({ ...GOOD, accent: [] })
    expect(suggested.accent[1]).toBe('#8a5a2b')
  })

  it('落在排除区：挪到最近的允许色相，彩度低的中性色不查', () => {
    const accentHue = oklch('#8e2a6b').h
    const excludedHues: HueRange[] = [[accentHue - 20, accentHue + 20]]
    const result = checkPalette({ palette: { ...GOOD, accent: ['#8e2a6b'] }, excludedHues })
    expect(result.findings.map(finding => finding.rule)).toEqual(['excluded_hue'])
    const fixed = result.suggested?.accent[0]
    if (!fixed) throw new Error('expected a suggestion')
    expect(isHueExcluded(oklch(fixed).h, excludedHues)).toBe(false)
  })

  it('图表明度乱序：按底色方向重排；明度相同的也拉开', () => {
    const shuffled = checkPalette({ palette: { ...GOOD, chart: ['#6f9a86', '#2f6b57', '#c8d8ce', '#a9c4b6'] } })
    expect(shuffled.findings.map(finding => finding.rule)).toEqual(['chart_order'])
    expect(shuffled.suggested?.chart).toEqual(GOOD.chart)
    const tied = checkPalette({ palette: { ...GOOD, chart: ['#6f9a86', '#6f9a86'] } })
    const lightness = tied.suggested?.chart.map(hex => oklch(hex).l) ?? []
    expect((lightness[1] ?? 0) - (lightness[0] ?? 1)).toBeGreaterThan(0)
  })

  it('深底上图表从浅到深', () => {
    const dark: PaletteDraft = { ...GOOD, bg: '#141a17', surface: '#1f2823', ink: '#eaefec', muted: '#a3b2aa', accent: ['#b8894a'], chart: ['#6f9a86', '#c8d8ce', '#a9c4b6'] }
    const result = checkPalette({ palette: dark })
    expect(result.findings.map(finding => finding.rule)).toEqual(['chart_order'])
    expect(result.suggested?.chart).toEqual(['#c8d8ce', '#a9c4b6', '#6f9a86'])
  })

  it('指定色不动：对比度不够时调底色，也不受排除区约束', () => {
    const pale = '#d9e021'
    const hue = oklch(pale).h
    const result = checkPalette({
      palette: { ...GOOD, bg: '#b8b8b0', surface: '#a8a8a0', accent: [pale], chart: GOOD.chart },
      pinnedColors: [pale.toUpperCase()],
      excludedHues: [[hue - 10, hue + 10]],
    })
    expect(result.findings.some(finding => finding.rule === 'excluded_hue')).toBe(false)
    expect(result.findings.some(finding => finding.rule === 'accent_contrast')).toBe(true)
    const suggested = result.suggested
    if (!suggested) throw new Error('expected a suggestion')
    expect(suggested.accent[0]).toBe(pale)
    expect(contrast(pale, suggested.bg)).toBeGreaterThanOrEqual(3)
  })

  it('两个指定色彼此对比度不够：报问题，不给改不出来的建议', () => {
    const result = checkPalette({ palette: { ...GOOD, bg: '#777777', ink: '#808080' }, pinnedColors: ['#777777', '#808080'] })
    expect(result.ok).toBe(false)
    expect(result.suggested).toBeNull()
  })

  it('写错的色值：只报 invalid_color，不给建议', () => {
    const result = checkPalette({ palette: { ...GOOD, ink: 'black-ish' } })
    expect(result.findings).toEqual([{ rule: 'invalid_color', role: 'ink', value: 'black-ish' }])
    expect(result.suggested).toBeNull()
  })
})
