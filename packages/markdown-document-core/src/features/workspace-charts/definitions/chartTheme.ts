/**
 * @file chartTheme.ts
 * @description 研究图表的内容色与主题合同。六套单色阶、三套多色色带，每套八色。
 *
 * 内容色由 Editor 拥有，不借用界面状态色。数组就是视觉顺序；不能为提高相邻色差而打散。
 * 柱、扇区使用原填充色；细线只在对背景不足 3:1 时调整明度，保持色相和彩度。
 */

import { MARKDOWN_CHART_DEFAULT_PALETTE, type MarkdownChartPalette } from '@app/schemas'
import { deriveInkColor } from '../functions/chartPalette'

export type ChartScheme = 'light' | 'dark'

export interface ChartPaletteEntry {
  /** 原色填充：柱、扇区、面积、图例键。 */
  readonly fill: string
  /** 同色相的可读细线：折线、标记、轮廓。 */
  readonly ink: string
}

export interface ChartThemeTokens {
  readonly scheme: ChartScheme
  readonly paletteCoreIndices?: readonly number[]
  /** 图表所在页面表面色：自定义线色的对比度与图片导出使用它。 */
  readonly surface: string
  readonly textPrimary: string
  readonly textSecondary: string
  readonly textMuted: string
  readonly gridColor: string
  /** 提示框使用反色：深底浅字（深色主题里浅底深字）。 */
  readonly tooltipBackground: string
  readonly tooltipText: string
  readonly fontFamily: string
  readonly palette: readonly ChartPaletteEntry[]
}

function entries(fills: readonly string[], scheme: ChartScheme): readonly ChartPaletteEntry[] {
  return Object.freeze(fills.map(fill => Object.freeze({ fill, ink: deriveInkColor(fill, scheme) })))
}

type SchemePalettes = Readonly<Record<ChartScheme, readonly ChartPaletteEntry[]> & {
  /** 五类时保留该色带的核心五色；仍是递增下标，不改变顺序。 */
  readonly coreIndices?: readonly number[]
}>

/** 多色色带亮暗共用原色，细线另做对比度适配；单色阶在暗色下反向明度。 */
export const CHART_PALETTES: Readonly<Record<MarkdownChartPalette, SchemePalettes>> = Object.freeze({
  verdant: {
    light: entries(['#347b45', '#3f8e4e', '#49a55c', '#6abc7f', '#7fc692', '#95d0a5', '#aadab8', '#bfe3ca'], 'light'),
    dark: entries(['#c9ead2', '#aadab8', '#8bd29e', '#6abc7f', '#54a96a', '#3f8e4e', '#32743f', '#275c33'], 'dark'),
  },
  teal: {
    light: entries(['#108b7e', '#159f91', '#14b8a6', '#42c7b6', '#72d6ca', '#91dfd5', '#abe6de', '#c3ede7'], 'light'),
    dark: entries(['#c3f4ed', '#a4efe3', '#7ce6d7', '#5ed6c5', '#3abfae', '#22a594', '#198979', '#116b61'], 'dark'),
  },
  aqua: {
    light: entries(['#337ea9', '#468fba', '#59a5cf', '#74b6d9', '#8fc7e5', '#a7d4ed', '#b9def2', '#cce6f4'], 'light'),
    dark: entries(['#d2edf9', '#b9e2f7', '#91cdf0', '#69b5e6', '#529ed0', '#408bb8', '#326f96', '#255675'], 'dark'),
  },
  violet: {
    light: entries(['#79519c', '#9065b0', '#a27bbf', '#b28fc9', '#bfa4d3', '#ccb4de', '#d6c2e5', '#dfd1eb'], 'light'),
    dark: entries(['#ecdef9', '#e0ccfa', '#d0b4f7', '#c299ed', '#ae7ed7', '#9665bf', '#7e53a1', '#634385'], 'dark'),
  },
  warm: {
    light: entries(['#e99c5c', '#eeaa6d', '#f1b77f', '#f4c391', '#f6cfa5', '#f8dab8', '#fae3c9', '#fcebd9'], 'light'),
    dark: entries(['#fde8cd', '#f9d9b5', '#f5cba0', '#f0bd8b', '#e9ae78', '#e09e65', '#d28d53', '#be7a43'], 'dark'),
  },
  mono: {
    light: entries(['#494949', '#606060', '#777777', '#8c8c8c', '#a1a1a1', '#b3b3b3', '#c4c4c4', '#d4d4d4'], 'light'),
    dark: entries(['#ededed', '#d5d5d5', '#bcbcbc', '#a5a5a5', '#8b8b8b', '#777777', '#646464', '#525252'], 'dark'),
  },
  sea: {
    light: entries(['#588d7e', '#7eb4a8', '#b9d8cf', '#dce8dc', '#aad1de', '#77c1c8', '#4d9aa8', '#3f839c'], 'light'),
    dark: entries(['#588d7e', '#7eb4a8', '#b9d8cf', '#dce8dc', '#aad1de', '#77c1c8', '#4d9aa8', '#3f839c'], 'dark'),
    coreIndices: [1, 3, 4, 5, 7],
  },
  pastel: {
    light: entries(['#7e9eca', '#aac3df', '#edce83', '#eead85', '#e6bdc9', '#d6869d', '#b885d5', '#8d8ac4'], 'light'),
    dark: entries(['#7e9eca', '#aac3df', '#edce83', '#eead85', '#e6bdc9', '#d6869d', '#b885d5', '#8d8ac4'], 'dark'),
    coreIndices: [1, 2, 3, 5, 6],
  },
  mist: {
    light: entries(['#607595', '#8898b4', '#9fbad3', '#bbd2e2', '#e9d1db', '#d4adba', '#d19cb6', '#a68095'], 'light'),
    dark: entries(['#607595', '#8898b4', '#9fbad3', '#bbd2e2', '#e9d1db', '#d4adba', '#d19cb6', '#a68095'], 'dark'),
    coreIndices: [0, 2, 3, 5, 7],
  },
})

/** 文字与提示框颜色缺失时的保守值，仅用于测试环境和样式尚未解析的瞬间。 */
export const FALLBACK_CHART_THEME: Readonly<Record<ChartScheme, Omit<ChartThemeTokens, 'palette' | 'paletteCoreIndices'>>> = Object.freeze({
  light: {
    scheme: 'light',
    surface: '#ffffff',
    textPrimary: '#171717',
    textSecondary: '#494949',
    textMuted: '#737373',
    gridColor: '#e5e5e5',
    tooltipBackground: '#404040',
    tooltipText: '#ffffff',
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
  dark: {
    scheme: 'dark',
    surface: '#262626',
    textPrimary: '#ededed',
    textSecondary: '#bcbcbc',
    textMuted: '#8b8b8b',
    gridColor: 'rgba(255, 255, 255, 0.16)',
    tooltipBackground: '#ededed',
    tooltipText: '#171717',
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
})

/** 不读取 DOM 的基础主题：图例颜色、测试和样式尚未解析时使用。 */
export function baseChartTheme(
  scheme: ChartScheme,
  palette: MarkdownChartPalette = MARKDOWN_CHART_DEFAULT_PALETTE,
): ChartThemeTokens {
  return { ...FALLBACK_CHART_THEME[scheme], paletteCoreIndices: CHART_PALETTES[palette].coreIndices, palette: CHART_PALETTES[palette][scheme] }
}
