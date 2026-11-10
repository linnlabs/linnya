import { describe, expect, it } from 'vitest'
import { admitMarkdownChartSpec, MARKDOWN_CHART_PALETTES, type MarkdownChartSpec } from '@app/schemas'
import { baseChartTheme } from '@linnya/markdown-document-core/workspace-charts'
import { mixColors, parseColor, rgbToOklch } from '@linnya/color-core'
import {
  categoryMarkColors,
  deriveInkColor,
  markColorsFromFill,
  paletteMarkColors,
  readableTextOn,
  seriesMarkColors,
} from '@linnya/markdown-document-core/workspace-charts'

function admit(input: Record<string, unknown>): MarkdownChartSpec {
  const result = admitMarkdownChartSpec(input)
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  return result.spec
}

function oklchOf(color: string) {
  const parsed = parseColor(color)
  if (!parsed) throw new Error(`Unparseable color: ${color}`)
  return rgbToOklch(parsed.channels)
}

describe('readableTextOn', () => {
  it('按填充明度选择文字色：浅填充用墨色，深填充用白色（rgb() 填充同样适用）', () => {
    expect(readableTextOn('#f2f2f2')).toBe('#0b0b0b')
    expect(readableTextOn('rgb(20, 20, 20)')).toBe('#ffffff')
    expect(readableTextOn('rgb(240, 240, 240)')).toBe('#0b0b0b')
    expect(readableTextOn('#aac3df')).toBe('#0b0b0b')
  })
})

describe('细线可读性与原色保留', () => {
  it('已经清晰的颜色保持原值，不统一压暗或降彩度', () => {
    expect(deriveInkColor('#336699', 'light')).toBe('#336699')
    expect(deriveInkColor('#edce83', 'dark')).toBe('#edce83')
  })

  it('浅底的浅色线变深、深底的深色线变亮；显式填充保持原值', () => {
    for (const [scheme, fill] of [['light', '#bbd2e2'], ['dark', '#335544']] as const) {
      const colors = markColorsFromFill(fill, baseChartTheme(scheme))
      expect(colors.fill).toBe(fill)
      expect(oklchOf(colors.ink).l > oklchOf(fill).l).toBe(scheme === 'dark')
      expect(Math.abs(oklchOf(colors.ink).h - oklchOf(fill).h)).toBeLessThan(4)
    }
    expect(oklchOf(deriveInkColor('#ffffff', 'light')).l).toBeLessThan(0.8)
    expect(oklchOf(deriveInkColor('#000000', 'dark')).l).toBeGreaterThan(0.5)
  })
})

describe('完整实体集上的有序取色', () => {
  it('各色系 2–8 个实体只沿色带递增取色，不交错或改变数据顺序', () => {
    for (const name of MARKDOWN_CHART_PALETTES) {
      const theme = baseChartTheme('light', name)
      for (let count = 2; count <= 8; count += 1) {
        const positions = Array.from({ length: count }, (_, index) =>
          theme.palette.indexOf(paletteMarkColors(theme, index, count)))
        expect(positions.every((slot, index) => slot >= 0 && (index === 0 || slot > (positions[index - 1] ?? -1)))).toBe(true)
      }
    }
  })

  it('超过八类沿相邻色延展，不循环回第一色；两端仍是色带两端', () => {
    const theme = baseChartTheme('light', 'mist')
    expect(paletteMarkColors(theme, 0, 15)).toEqual(theme.palette[0])
    expect(paletteMarkColors(theme, 14, 15)).toEqual(theme.palette[7])
    expect(paletteMarkColors(theme, 8, 15)).toEqual(theme.palette[4])
    const first = theme.palette[0]
    const second = theme.palette[1]
    if (!first || !second) throw new Error('Expected palette endpoints')
    expect(paletteMarkColors(theme, 1, 15).fill).toBe(mixColors(first.fill, second.fill, 0.5))
  })

  it('显式色覆盖对应实体，不挤占或挪动其他实体的槽位；逐点 null 继承', () => {
    const theme = baseChartTheme('light', 'pastel')
    const spec = admit({ chartType: 'bar', categories: ['a'], series: [
      { name: 'p', values: [1] }, { name: 'q', values: [1], color: '#112233' }, { name: 'r', values: [1] },
    ] })
    const colors = spec.series.map((series, index) => seriesMarkColors(theme, index, series, spec.series.length))
    expect(colors[0]).toEqual(theme.palette[0])
    expect(colors[1]?.fill).toBe('#112233')
    expect(colors[2]).toEqual(theme.palette[7])
    const parts = admit({ chartType: 'pie', categories: ['a', 'b'], series: [{ name: 's', values: [1, 2], pointColors: ['#abcdef', null] }] })
    expect(categoryMarkColors(theme, 0, parts.series[0], 2).fill).toBe('#ABCDEF')
    expect(categoryMarkColors(theme, 1, parts.series[0], 2)).toEqual(theme.palette[7])
  })
})
