import { describe, expect, it } from 'vitest'
import { admitMarkdownChartSpec, type MarkdownChartSpec } from '@app/schemas'
import { CHART_PALETTES, baseChartTheme } from '../definitions/chartTheme'
import { rgbToOklch } from './chartColorSpace'
import {
  categoryMarkColors,
  deriveInkColor,
  markColorsFromFill,
  mixColors,
  paletteMarkColors,
  parseColor,
  readableTextOn,
  seriesMarkColors,
  withAlpha,
} from './chartPalette'

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

describe('parseColor', () => {
  it('解析 #RRGGBB 与 #RGB', () => {
    expect(parseColor('#336699')).toEqual({ channels: [51, 102, 153], alpha: 1 })
    expect(parseColor('#fa0')).toEqual({ channels: [255, 170, 0], alpha: 1 })
  })

  it('解析浏览器里 token 经 canvas 解析后的 rgb()/rgba()', () => {
    expect(parseColor('rgb(23, 23, 23)')).toEqual({ channels: [23, 23, 23], alpha: 1 })
    expect(parseColor('rgba(255, 255, 255, 0.16)')).toEqual({ channels: [255, 255, 255], alpha: 0.16 })
    expect(parseColor('rgb(1 2 3 / 50%)')).toEqual({ channels: [1, 2, 3], alpha: 0.5 })
  })

  it('不认识的写法返回 null，而不是猜一个颜色', () => {
    expect(parseColor('red')).toBeNull()
    expect(parseColor('var(--color-text-primary)')).toBeNull()
    expect(parseColor('')).toBeNull()
  })
})

describe('withAlpha', () => {
  it('对十六进制与 rgb() 都叠加透明度', () => {
    expect(withAlpha('#336699', 0.1)).toBe('rgba(51, 102, 153, 0.1)')
    expect(withAlpha('rgb(23, 23, 23)', 0.05)).toBe('rgba(23, 23, 23, 0.05)')
  })

  it('已有透明度相乘，不会被覆盖成不透明', () => {
    expect(withAlpha('rgba(255, 255, 255, 0.16)', 0.5)).toBe('rgba(255, 255, 255, 0.08)')
  })

  it('不认识的颜色宁可不画（transparent），也不画成不透明的色块', () => {
    expect(withAlpha('red', 0.05)).toBe('transparent')
  })
})

describe('mixColors / readableTextOn', () => {
  it('rgb() 输入同样可以混色', () => {
    expect(mixColors('rgb(0, 0, 0)', 'rgb(255, 255, 255)', 0.5)).toBe('#808080')
  })

  it('混色对非十六进制输入保持稳定', () => {
    expect(mixColors('red', '#ffffff', 0.5)).toBe('red')
  })

  it('按填充明度选择文字色：浅填充用墨色，深填充用白色（rgb() 填充同样适用）', () => {
    expect(readableTextOn('#f2f2f2')).toBe('#0b0b0b')
    expect(readableTextOn('rgb(20, 20, 20)')).toBe('#ffffff')
    expect(readableTextOn('rgb(240, 240, 240)')).toBe('#0b0b0b')
  })
})

describe('deriveInkColor：由填充派生同色相的描线', () => {
  it('浅色主题：淡填充压深到 L 0.42–0.57，描线与填充同色相', () => {
    const fill = '#f3eabd'
    const ink = deriveInkColor(fill, 'light')
    const derived = oklchOf(ink)
    expect(derived.l).toBeGreaterThanOrEqual(0.41)
    expect(derived.l).toBeLessThanOrEqual(0.58)
    expect(Math.abs(derived.h - oklchOf(fill).h)).toBeLessThan(6)
  })

  it('浅色主题：已经较深的填充只再深一点，不会变黑', () => {
    const fill = '#466e4e'
    const derived = oklchOf(deriveInkColor(fill, 'light'))
    expect(derived.l).toBeLessThan(oklchOf(fill).l)
    expect(derived.l).toBeGreaterThanOrEqual(0.28)
  })

  it('深色主题：描线提亮到 L 0.62–0.84', () => {
    const derived = oklchOf(deriveInkColor('#365a4f', 'dark'))
    expect(derived.l).toBeGreaterThanOrEqual(0.61)
    expect(derived.l).toBeLessThanOrEqual(0.85)
  })

  it('高饱和的作者色派生出克制的描线：彩度约 0.09 封顶（量化成 8 位色后留 0.005 误差）', () => {
    for (const scheme of ['light', 'dark'] as const) {
      expect(oklchOf(deriveInkColor('#ff2d2d', scheme)).c).toBeLessThanOrEqual(0.095)
    }
  })

  it('无法解析的颜色原样返回，而不是编造一个描线', () => {
    expect(deriveInkColor('oklch(0.7 0.1 150)', 'light')).toBe('oklch(0.7 0.1 150)')
  })
})

describe('颜色随实体', () => {
  const theme = baseChartTheme('light')
  const palette = CHART_PALETTES.verdant.light

  it('按完整规格中的序号取色；作者显式色被当作填充，保持原值并派生描线', () => {
    const spec = admit({
      chartType: 'bar', categories: ['a'],
      series: [{ name: 'p', values: [1] }, { name: 'q', values: [1], color: '#112233' }, { name: 'r', values: [1] }],
    })
    const colors = spec.series.map((series, index) => seriesMarkColors(theme, index, series))
    expect(colors[0]).toEqual(palette[0])
    expect(colors[1]?.fill).toBe('#112233')
    expect(colors[1]?.ink).toBe(deriveInkColor('#112233', 'light'))
    expect(colors[2]).toEqual(palette[2])
  })

  it('第 9 个起使用同序的更浅色调，不生成新色相', () => {
    const first = paletteMarkColors(theme, 0)
    const ninth = paletteMarkColors(theme, 8)
    expect(first).toEqual(palette[0])
    expect(ninth.fill).toBe(mixColors(palette[0]?.fill ?? '', theme.surface, 0.35))
    expect(ninth.ink).toBe(mixColors(palette[0]?.ink ?? '', theme.surface, 0.35 * 0.6))
    expect(ninth).not.toEqual(first)
    expect(paletteMarkColors(theme, 7)).toEqual(palette[7])
    // 色调只会越来越浅，直到上限：第 17 个与第 25 个相同。
    expect(paletteMarkColors(theme, 24)).toEqual(paletteMarkColors(theme, 16))
  })

  it('逐点色中的 null 沿用按类目序号取得的默认色，显式色作为填充', () => {
    const spec = admit({ chartType: 'pie', categories: ['a', 'b'], series: [{ name: 's', values: [1, 2], pointColors: [null, '#abcdef'] }] })
    const series = spec.series[0]
    expect(categoryMarkColors(theme, 0, series)).toEqual(palette[0])
    expect(categoryMarkColors(theme, 1, series).fill).toBe('#ABCDEF')
    expect(categoryMarkColors(theme, 1, undefined)).toEqual(palette[1])
  })

  it('色系跟随规格的 palette：同一序号在不同色系里取到各自的颜色', () => {
    const aqua = baseChartTheme('light', 'aqua')
    expect(paletteMarkColors(aqua, 1)).toEqual(CHART_PALETTES.aqua.light[1])
    expect(paletteMarkColors(aqua, 1)).not.toEqual(paletteMarkColors(theme, 1))
  })

  it('markColorsFromFill 按主题方向派生描线', () => {
    expect(markColorsFromFill('#8aa2c8', baseChartTheme('light')).ink).not.toBe(markColorsFromFill('#8aa2c8', baseChartTheme('dark')).ink)
  })
})
