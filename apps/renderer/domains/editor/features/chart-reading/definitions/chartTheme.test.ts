import { describe, expect, it } from 'vitest'
import { MARKDOWN_CHART_DEFAULT_PALETTE, MARKDOWN_CHART_PALETTES, type MarkdownChartPalette } from '@app/schemas'
import { rgbToOklch } from '../functions/chartColorSpace'
import { parseColor } from '../functions/chartPalette'
import { CHART_PALETTES, FALLBACK_CHART_THEME, baseChartTheme, type ChartPaletteEntry, type ChartScheme } from './chartTheme'

const SCHEMES: readonly ChartScheme[] = ['light', 'dark']
const SLOT_COUNT = 8
/** 折线只靠描线区分：这么多个槽位以内，描线必须两两拉开。 */
const LINE_SLOTS = 4

function channelsOf(color: string): readonly [number, number, number] {
  const parsed = parseColor(color)
  if (!parsed) throw new Error(`Unparseable color: ${color}`)
  return parsed.channels
}

function oklab(color: string) {
  const { l, c, h } = rgbToOklch(channelsOf(color))
  const radians = (h * Math.PI) / 180
  return { l, c, a: c * Math.cos(radians), b: c * Math.sin(radians) }
}

/** OKLab 欧氏距离 ×100。 */
function deltaE(first: string, second: string): number {
  const x = oklab(first)
  const y = oklab(second)
  return 100 * Math.hypot(x.l - y.l, x.a - y.a, x.b - y.b)
}

function luminance(color: string): number {
  const [red, green, blue] = channelsOf(color).map(channel => {
    const scaled = channel / 255
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrastRatio(first: string, second: string): number {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a) as [number, number]
  return (light + 0.05) / (dark + 0.05)
}

function minimum(values: readonly number[]): number {
  return values.reduce((least, value) => Math.min(least, value), Number.POSITIVE_INFINITY)
}

function pairsOf<T>(items: readonly T[]): [number, number][] {
  const pairs: [number, number][] = []
  for (let first = 0; first < items.length; first += 1) {
    for (let second = first + 1; second < items.length; second += 1) pairs.push([first, second])
  }
  return pairs
}

function eachPalette(run: (family: MarkdownChartPalette, scheme: ChartScheme, entries: readonly ChartPaletteEntry[]) => void): void {
  for (const family of MARKDOWN_CHART_PALETTES) {
    for (const scheme of SCHEMES) run(family, scheme, CHART_PALETTES[family][scheme])
  }
}

describe('图表色系合同', () => {
  it('色系名称与规格里的 palette 枚举一一对应，默认色系是绿', () => {
    expect(Object.keys(CHART_PALETTES).sort()).toEqual([...MARKDOWN_CHART_PALETTES].sort())
    expect(MARKDOWN_CHART_DEFAULT_PALETTE).toBe('verdant')
    expect(baseChartTheme('light').palette).toBe(CHART_PALETTES.verdant.light)
    expect(baseChartTheme('dark', 'aqua').palette).toBe(CHART_PALETTES.aqua.dark)
  })

  it('每个色系在亮/暗主题下各有 8 个槽位，色值都是 #rrggbb，描线与填充不同', () => {
    eachPalette((family, scheme, entries) => {
      expect(entries, `${family}/${scheme}`).toHaveLength(SLOT_COUNT)
      for (const entry of entries) {
        expect(entry.fill).toMatch(/^#[0-9a-f]{6}$/)
        expect(entry.ink).toMatch(/^#[0-9a-f]{6}$/)
        expect(entry.ink).not.toBe(entry.fill)
      }
    })
  })

  it('相邻槽位的填充色差 ≥ 12，默认色系 ≥ 18：相邻的柱、面积、扇区一眼可分', () => {
    eachPalette((family, scheme, entries) => {
      const adjacent = entries.slice(1).map((entry, index) => deltaE(entries[index]?.fill ?? '', entry.fill))
      const floor = family === MARKDOWN_CHART_DEFAULT_PALETTE ? 18 : 12
      expect(minimum(adjacent), `${family}/${scheme}`).toBeGreaterThanOrEqual(floor)
    })
  })

  it('任意两个槽位的填充、描线都不会撞成同一个颜色（色差 ≥ 4）', () => {
    eachPalette((family, scheme, entries) => {
      for (const [first, second] of pairsOf(entries)) {
        expect(deltaE(entries[first]?.fill ?? '', entries[second]?.fill ?? ''), `${family}/${scheme} 填充 ${first}-${second}`).toBeGreaterThanOrEqual(4)
        expect(deltaE(entries[first]?.ink ?? '', entries[second]?.ink ?? ''), `${family}/${scheme} 描线 ${first}-${second}`).toBeGreaterThanOrEqual(4)
      }
    })
  })

  it(`折线只靠描线区分：前 ${LINE_SLOTS} 个槽位两两描线色差，亮色 ≥ 8、暗色 ≥ 6`, () => {
    eachPalette((family, scheme, entries) => {
      const inks = entries.slice(0, LINE_SLOTS).map(entry => entry.ink)
      const floor = scheme === 'light' ? 8 : 6
      expect(minimum(pairsOf(inks).map(([first, second]) => deltaE(inks[first] ?? '', inks[second] ?? ''))), `${family}/${scheme}`).toBeGreaterThanOrEqual(floor)
    })
  })

  it('描线对页面表面的对比度：亮色 ≥ 4.3:1、暗色 ≥ 5.4:1，淡填充靠描线勾出形状', () => {
    eachPalette((family, scheme, entries) => {
      const surface = FALLBACK_CHART_THEME[scheme].surface
      const floor = scheme === 'light' ? 4.3 : 5.4
      expect(minimum(entries.map(entry => contrastRatio(entry.ink, surface))), `${family}/${scheme}`).toBeGreaterThanOrEqual(floor)
      // 描线与自身填充要能分辨，轮廓才看得出来。
      expect(minimum(entries.map(entry => deltaE(entry.ink, entry.fill))), `${family}/${scheme} 轮廓`).toBeGreaterThanOrEqual(9.5)
    })
  })

  it('低饱和：填充彩度 ≤ 0.09 且平均 ≤ 0.08，描线彩度 ≤ 0.08', () => {
    eachPalette((family, scheme, entries) => {
      const fillChroma = entries.map(entry => oklab(entry.fill).c)
      expect(Math.max(...fillChroma), `${family}/${scheme} 填充最大`).toBeLessThanOrEqual(0.09)
      expect(fillChroma.reduce((sum, value) => sum + value, 0) / fillChroma.length, `${family}/${scheme} 填充平均`).toBeLessThanOrEqual(0.08)
      expect(Math.max(...entries.map(entry => oklab(entry.ink).c)), `${family}/${scheme} 描线`).toBeLessThanOrEqual(0.08)
    })
  })

  it('暗色主题里明暗互换：亮色最淡的槽位在暗色里是最暗的两个之一', () => {
    for (const family of MARKDOWN_CHART_PALETTES) {
      const light = CHART_PALETTES[family].light.map(entry => oklab(entry.fill).l)
      const dark = CHART_PALETTES[family].dark.map(entry => oklab(entry.fill).l)
      const palest = light.indexOf(Math.max(...light))
      const dimmestTwo = dark.map((lightness, index) => ({ lightness, index })).sort((a, b) => a.lightness - b.lightness).slice(0, 2).map(item => item.index)
      expect(dimmestTwo, family).toContain(palest)
    }
  })
})

describe('提示框与文字的后备颜色', () => {
  it('提示框反色：深底浅字（暗色主题里浅底深字），对比度足够', () => {
    for (const scheme of SCHEMES) {
      const theme = FALLBACK_CHART_THEME[scheme]
      expect(contrastRatio(theme.tooltipBackground, theme.tooltipText), scheme).toBeGreaterThanOrEqual(7)
      expect(luminance(theme.tooltipBackground) < luminance(theme.tooltipText), scheme).toBe(scheme === 'light')
    }
  })

  it('次要文字对表面的对比度 ≥ 4.5:1，弱化文字 ≥ 3:1', () => {
    for (const scheme of SCHEMES) {
      const theme = FALLBACK_CHART_THEME[scheme]
      expect(contrastRatio(theme.textSecondary, theme.surface), scheme).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(theme.textMuted, theme.surface), scheme).toBeGreaterThanOrEqual(3)
    }
  })
})
