/**
 * @file chartPalette.ts
 * @description 颜色随“实体”而不是随“排名”：系列/类目的颜色由其在完整规格中的位置决定。
 *
 * 每个实体有两个颜色：低饱和高明度的**填充**和同色相更深的**描线**（见 chartTheme.ts）。
 * 隐藏系列、聚焦范围都不会重新分配颜色。作者显式给出的颜色保持其含义，不按主题偷偷换色：
 * 它被当作填充，描线由它派生（同色相，浅色主题里更深、深色主题里更亮）。
 * 超过 8 个实体时不再生成新色相，而是在同一色系上叠加更浅的色调，并依赖图例与数据表识别。
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

/** 描线色的最大彩度：低饱和的描线才与低饱和的填充相配，也避免作者的高饱和填充派生出刺眼的描线。 */
const INK_MAX_CHROMA = 0.09

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * 由填充派生同色相的描线。浅色主题：淡填充（L > 0.62）压到 0.42–0.57，使描线对白底 ≥ 4:1；已经较深的填充再深一点。
 * 深色主题：描线提亮到 0.62–0.84。无法解析的颜色原样返回。
 */
export function deriveInkColor(fill: string, scheme: ChartScheme): string {
  const parsed = parseColor(fill)
  if (!parsed) return fill
  const { l, c, h } = rgbToOklch(parsed.channels)
  const lightness = scheme === 'light'
    ? (l > 0.62 ? clamp(l - 0.3, 0.42, 0.57) : Math.max(0.28, l - 0.1))
    : clamp(l + 0.22, 0.62, 0.84)
  return toHex(oklchToRgb({ l: lightness, c: Math.min(c, INK_MAX_CHROMA), h }))
}

/** 作者显式给出的单色：作为填充，派生描线。 */
export function markColorsFromFill(fill: string, theme: Pick<ChartThemeTokens, 'scheme'>): ChartMarkColors {
  return { fill, ink: deriveInkColor(fill, theme.scheme) }
}

export function paletteMarkColors(theme: ChartThemeTokens, index: number): ChartMarkColors {
  const size = theme.palette.length
  const base = theme.palette[index % size]
  if (base === undefined) throw new RangeError('Chart palette must be non-empty and index non-negative')
  const cycle = Math.floor(index / size)
  if (cycle === 0) return base
  const tint = Math.min(0.7, cycle * 0.35)
  return { fill: mixColors(base.fill, theme.surface, tint), ink: mixColors(base.ink, theme.surface, tint * 0.6) }
}

export function seriesMarkColors(theme: ChartThemeTokens, seriesIndex: number, series: ChartSeries): ChartMarkColors {
  return series.color === undefined ? paletteMarkColors(theme, seriesIndex) : markColorsFromFill(series.color, theme)
}

/** 饼/环与逐点着色：pointColors 中的 null 沿用按类目序号取得的默认色。 */
export function categoryMarkColors(
  theme: ChartThemeTokens,
  categoryIndex: number,
  series: ChartSeries | undefined,
): ChartMarkColors {
  const explicit = series?.pointColors?.[categoryIndex]
  return explicit ? markColorsFromFill(explicit, theme) : paletteMarkColors(theme, categoryIndex)
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
  return luminance !== null && luminance > 0.42 ? '#0b0b0b' : '#ffffff'
}
