/**
 * @file chartPalette.ts
 * @description 顺序取色与内容色运算。颜色依据完整规格的实体位置和数量，阅读筛选不重排。
 * 默认色在八槽色带内有序采样；作者色保持填充值，细线按背景做最小明度调整。
 */

import type { MarkdownChartSeriesReadView as ChartSeries } from '@app/schemas'
import type { ChartScheme, ChartThemeTokens } from '../definitions/chartTheme'
import { oklchToRgb, rgbToOklch } from './chartColorSpace'

interface ParsedColor {
  readonly channels: readonly [number, number, number]
  readonly alpha: number
}

const HEX_FULL = /^#([0-9a-f]{6})$/i
const HEX_SHORT = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i
const FUNCTIONAL = /^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i

function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)))
}

/**
 * 解析图表会遇到的颜色写法：`#RRGGBB`（作者显式色、测试用后备主题）、`#RGB`，以及
 * `rgb()` / `rgba()`（浏览器里 token 经 canvas 解析后的形式）。其他写法返回 null，由调用方决定降级方式。
 */
export function parseColor(color: string): ParsedColor | null {
  const text = color.trim()
  const full = HEX_FULL.exec(text)
  if (full) {
    const value = text.slice(1)
    return {
      channels: [
        Number.parseInt(value.slice(0, 2), 16),
        Number.parseInt(value.slice(2, 4), 16),
        Number.parseInt(value.slice(4, 6), 16),
      ],
      alpha: 1,
    }
  }
  const short = HEX_SHORT.exec(text)
  if (short) {
    const red = text.charAt(1)
    const green = text.charAt(2)
    const blue = text.charAt(3)
    return {
      channels: [Number.parseInt(red + red, 16), Number.parseInt(green + green, 16), Number.parseInt(blue + blue, 16)],
      alpha: 1,
    }
  }
  const functional = FUNCTIONAL.exec(text)
  if (functional) {
    const [, red, green, blue, alpha] = functional
    const alphaValue = alpha === undefined ? 1 : alpha.endsWith('%') ? Number.parseFloat(alpha) / 100 : Number.parseFloat(alpha)
    return {
      channels: [clampChannel(Number(red)), clampChannel(Number(green)), clampChannel(Number(blue))],
      alpha: Math.min(1, Math.max(0, alphaValue)),
    }
  }
  return null
}

function toHex(channels: readonly number[]): string {
  return `#${channels.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')}`
}

/** 在 `from` 与 `to` 之间按比例混色（输出 `#rrggbb`，忽略透明度）；任一颜色无法解析时原样返回 `from`。 */
export function mixColors(from: string, to: string, ratio: number): string {
  const a = parseColor(from)
  const b = parseColor(to)
  if (!a || !b) return from
  const t = Math.min(1, Math.max(0, ratio))
  const blend = (index: 0 | 1 | 2) => a.channels[index] + (b.channels[index] - a.channels[index]) * t
  return toHex([blend(0), blend(1), blend(2)])
}

/**
 * 给颜色叠加透明度（已有透明度相乘）。无法解析的颜色返回 `transparent`：
 * 这个函数用于辅助线、指示带这类“淡”元素，宁可不画，也不能因为格式不认识而画成不透明的色块。
 */
export function withAlpha(color: string, alpha: number): string {
  const parsed = parseColor(color)
  if (!parsed) return 'transparent'
  const [red, green, blue] = parsed.channels
  const combined = Math.round(Math.min(1, Math.max(0, alpha)) * parsed.alpha * 1000) / 1000
  return `rgba(${red}, ${green}, ${blue}, ${combined})`
}

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
  if (!parsed) return fill
  const { l, c, h } = rgbToOklch(parsed.channels)
  let ink = fill
  let lightness = l
  const background = relativeLuminance(surface)
  if (background === null) return fill
  const contrast = (color: string) => {
    const luminance = relativeLuminance(color) ?? background
    return (Math.max(luminance, background) + 0.05) / (Math.min(luminance, background) + 0.05)
  }
  while (contrast(ink) < 3) {
    const next = Math.min(1, Math.max(0, lightness + (scheme === 'light' ? -0.02 : 0.02)))
    if (next === lightness) break
    lightness = next
    ink = toHex(oklchToRgb({ l: lightness, c, h }))
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

function relativeLuminance(color: string): number | null {
  const parsed = parseColor(color)
  if (!parsed) return null
  const luminance = (channel: number) => {
    const scaled = channel / 255
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * luminance(parsed.channels[0]) + 0.7152 * luminance(parsed.channels[1]) + 0.0722 * luminance(parsed.channels[2])
}

/** 落在填充色内部的文字：按填充明度在白色与墨色之间选择，保证可读。 */
export function readableTextOn(fill: string): string {
  const luminance = relativeLuminance(fill)
  if (luminance === null) return '#0b0b0b'
  const darkLuminance = relativeLuminance('#0b0b0b') ?? 0
  const darkContrast = (luminance + 0.05) / (darkLuminance + 0.05)
  const lightContrast = 1.05 / (luminance + 0.05)
  return darkContrast >= lightContrast ? '#0b0b0b' : '#ffffff'
}
