/**
 * @file chartPalette.ts
 * @description 顺序取色与细线色派生。颜色依据完整规格的实体位置和数量，阅读筛选不重排。
 * 默认色在八槽色带内有序采样；作者色保持填充值，细线按背景做最小明度调整。
 * 颜色解析、色彩空间与对比度归 `@linnya/color-core`，这里只放图表规则。
 */

import type { MarkdownChartSeriesReadView as ChartSeries } from '@app/schemas'
import type { ChartScheme, ChartThemeTokens } from '../definitions/chartTheme'
import {
  contrastRatio,
  mixColors,
  oklchToRgb,
  parseColor,
  relativeLuminance,
  rgbToOklch,
  toHex,
  type RgbChannels,
} from '@linnya/color-core'

/** 一个实体的两个颜色。 */
export interface ChartMarkColors {
  readonly fill: string
  readonly ink: string
}

/**
 * 细线需要在背景上可辨，已经足够清晰的色值原样使用。
 * 只调整不足 3:1 的明度，不把整套原色压暗、降彩度；填充始终保留原值。
 */
export function deriveInkColor(fill: string, scheme: ChartScheme, surface = scheme === 'light' ? '#ffffff' : '#262626'): string {
  const parsed = parseColor(fill)
  const background = parseColor(surface)
  if (!parsed || !background) return fill
  const { l, c, h } = rgbToOklch(parsed.channels)
  let ink = fill
  let inkChannels = parsed.channels
  let lightness = l
  while (contrastRatio(inkChannels, background.channels) < 3) {
    const next = Math.min(1, Math.max(0, lightness + (scheme === 'light' ? -0.02 : 0.02)))
    if (next === lightness) break
    lightness = next
    ink = toHex(oklchToRgb({ l: lightness, c, h }))
    inkChannels = parseColor(ink)?.channels ?? inkChannels
  }
  return ink
}

/** 作者显式给出的单色：作为填充，派生描线。 */
export function markColorsFromFill(fill: string, theme: Pick<ChartThemeTokens, 'scheme' | 'surface'>): ChartMarkColors {
  return { fill, ink: deriveInkColor(fill, theme.scheme, theme.surface) }
}

export function paletteMarkColors(theme: ChartThemeTokens, index: number, count: number): ChartMarkColors {
  const size = theme.palette.length
  const core = theme.paletteCoreIndices
  const position = count === 1 ? 0 : core && count === core.length
    ? core[index] ?? Number.NaN : index * (size - 1) / (count - 1)
  // 八类以内按有序子序列选色；超过八类沿相邻色插值，不绕回第一色造成跳色。
  const slot = count <= size ? Math.round(position) : Math.floor(position)
  const base = theme.palette[slot]
  if (base === undefined) throw new RangeError('Chart palette index must belong to the complete entity set')
  const next = theme.palette[Math.min(slot + 1, size - 1)]
  if (count <= size || !next) return base
  const ratio = position - slot
  return { fill: mixColors(base.fill, next.fill, ratio), ink: mixColors(base.ink, next.ink, ratio) }
}

export function seriesMarkColors(theme: ChartThemeTokens, seriesIndex: number, series: ChartSeries, count: number): ChartMarkColors {
  return series.color === undefined ? paletteMarkColors(theme, seriesIndex, count) : markColorsFromFill(series.color, theme)
}

/** 饼/环与逐点着色：pointColors 中的 null 沿用按类目序号取得的默认色。 */
export function categoryMarkColors(
  theme: ChartThemeTokens,
  categoryIndex: number,
  series: ChartSeries | undefined,
  count: number,
): ChartMarkColors {
  const explicit = series?.pointColors?.[categoryIndex]
  return explicit ? markColorsFromFill(explicit, theme) : paletteMarkColors(theme, categoryIndex, count)
}

const DARK_TEXT_CHANNELS: RgbChannels = [11, 11, 11]
const DARK_TEXT = toHex(DARK_TEXT_CHANNELS)

/** 落在填充色内部的文字：按填充明度在白色与墨色之间选择，保证可读。 */
export function readableTextOn(fill: string): string {
  const parsed = parseColor(fill)
  if (!parsed) return DARK_TEXT
  const luminance = relativeLuminance(parsed.channels)
  const darkContrast = (luminance + 0.05) / (relativeLuminance(DARK_TEXT_CHANNELS) + 0.05)
  const lightContrast = 1.05 / (luminance + 0.05)
  return darkContrast >= lightContrast ? DARK_TEXT : '#ffffff'
}
