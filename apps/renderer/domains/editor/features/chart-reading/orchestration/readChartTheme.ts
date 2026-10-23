/**
 * @file readChartTheme.ts
 * @description 从当前 DOM 解析图表主题：色系按亮/暗与规格的 `palette` 选择，其余颜色读取 renderer-ui 的语义 token。
 *
 * 样式只在挂载、主题切换和导出时读取一次；解析结果是不可变的纯值，option 构建不再触碰 DOM。
 * CSS 颜色（含 `color-mix()`）统一经 canvas 解析为 rgba，保证 ECharts 能够识别。
 */

import { RENDERER_UI_THEME_ATTRIBUTE, type RendererUiTheme } from '@linnya/renderer-ui/theme'
import { MARKDOWN_CHART_DEFAULT_PALETTE, type MarkdownChartPalette } from '@app/schemas'
import {
  CHART_PALETTES,
  FALLBACK_CHART_THEME,
  baseChartTheme,
  type ChartScheme,
  type ChartThemeTokens,
} from '../definitions/chartTheme'

/** 月白蓝是用户显式选择的浅色变体，与 light 使用同一组亮色色系。 */
export function chartSchemeOfTheme(theme: string | null): ChartScheme {
  return theme === 'dark' ? 'dark' : 'light'
}

export function readActiveChartTheme(doc: Document = document): string | null {
  return doc.documentElement.getAttribute(RENDERER_UI_THEME_ATTRIBUTE)
}

export function readActiveChartScheme(doc: Document = document): ChartScheme {
  return chartSchemeOfTheme(readActiveChartTheme(doc))
}

let probeCanvas: HTMLCanvasElement | null = null

/** 把任意 CSS 颜色解析为 `rgba()`；解析不了时原样返回（例如没有 canvas 的测试环境）。 */
export function resolveCssColor(color: string, doc: Document = document): string {
  const trimmed = color.trim()
  if (trimmed === '') return trimmed
  try {
    probeCanvas ??= doc.createElement('canvas')
    probeCanvas.width = 1
    probeCanvas.height = 1
    const context = probeCanvas.getContext('2d', { willReadFrequently: true })
    if (!context) return trimmed
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = '#000'
    context.fillStyle = trimmed
    context.fillRect(0, 0, 1, 1)
    const [red = 0, green = 0, blue = 0, alpha = 255] = context.getImageData(0, 0, 1, 1).data
    return alpha === 255 ? `rgb(${red}, ${green}, ${blue})` : `rgba(${red}, ${green}, ${blue}, ${Math.round((alpha / 255) * 1000) / 1000})`
  } catch {
    return trimmed
  }
}

/** 向上寻找第一个不透明的背景色：图表的“表面”就是它所处页面的表面。 */
function resolveSurface(host: Element, fallback: string): string {
  const view = host.ownerDocument.defaultView
  for (let element: Element | null = host; element && view; element = element.parentElement) {
    const background = view.getComputedStyle(element).backgroundColor
    if (background && background !== 'transparent' && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(background)) {
      return resolveCssColor(background, host.ownerDocument)
    }
  }
  return fallback
}

function readToken(style: CSSStyleDeclaration, name: string, fallback: string, doc: Document): string {
  const value = style.getPropertyValue(name).trim()
  return value ? resolveCssColor(value, doc) : fallback
}

/** ECharts 的 SVG 输出把 font-family 放进双引号属性；字体名里的双引号必须换成单引号。 */
export function sanitizeFontFamily(fontFamily: string): string {
  return fontFamily.replace(/"/g, "'")
}

export function resolveChartTheme(
  host: Element,
  scheme: ChartScheme = readActiveChartScheme(host.ownerDocument),
  palette: MarkdownChartPalette = MARKDOWN_CHART_DEFAULT_PALETTE,
): ChartThemeTokens {
  const doc = host.ownerDocument
  const fallback = FALLBACK_CHART_THEME[scheme]
  const view = doc.defaultView
  if (!view) return baseChartTheme(scheme, palette)

  const style = view.getComputedStyle(host)
  return {
    scheme,
    surface: resolveSurface(host, fallback.surface),
    textPrimary: readToken(style, '--color-text-primary', fallback.textPrimary, doc),
    textSecondary: readToken(style, '--color-text-secondary', fallback.textSecondary, doc),
    textMuted: readToken(style, '--color-text-muted', fallback.textMuted, doc),
    gridColor: readToken(style, '--color-border-light', fallback.gridColor, doc),
    // 提示框反色：深底浅字，随主题取界面里现成的反色 token。
    tooltipBackground: readToken(style, '--color-bg-inverse', fallback.tooltipBackground, doc),
    tooltipText: readToken(style, '--color-text-inverse', fallback.tooltipText, doc),
    fontFamily: sanitizeFontFamily(style.fontFamily || fallback.fontFamily),
    palette: CHART_PALETTES[palette][scheme],
    paletteCoreIndices: CHART_PALETTES[palette].coreIndices,
  }
}

/** 主题属性变化的订阅：由 `documentElement` 上的 UI 主题属性驱动，按需解除。 */
export function observeChartTheme(onChange: (theme: string | null) => void, doc: Document = document): () => void {
  let current = readActiveChartTheme(doc)
  const observer = new MutationObserver(() => {
    const next = readActiveChartTheme(doc)
    if (next === current) return
    current = next
    onChange(next)
  })
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: [RENDERER_UI_THEME_ATTRIBUTE] })
  return () => observer.disconnect()
}

export type { RendererUiTheme }
