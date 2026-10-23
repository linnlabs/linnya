/**
 * @file chartTheme.ts
 * @description 图表主题合同：色系（填充 + 描线双色）与随主题变化的文字、表面、提示框颜色。
 *
 * 色系是低饱和、高明度的“同一色系”：每个槽位有一个淡的**填充**（柱、扇区、面积）和一个同色相更深的**描线**
 * （折线、标记、轮廓）。淡填充在白底上的对比度只有约 1.1–1.3:1，描线负责把形状勾出来。
 * 深色主题里明暗互换：浅色里最淡的槽位在深色里最暗，描线更亮。
 *
 * 槽位顺序固定、不循环生成新色相。色值由 `chartTheme.test.ts` 约束，改色值必须过它：
 * - 相邻槽位的填充色差（OKLab ×100）≥ 12，默认色系 ≥ 18；任意两个槽位的填充与描线色差都 ≥ 4；
 * - 折线只靠描线区分，所以前 4 个槽位两两的描线色差：浅色 ≥ 8、深色 ≥ 6；
 * - 描线对表面的对比度：浅色 ≥ 4.3:1、深色 ≥ 5.4:1；描线彩度 ≤ 0.08，填充彩度 ≤ 0.09。
 */

import { MARKDOWN_CHART_DEFAULT_PALETTE, type MarkdownChartPalette } from '@app/schemas'

export type ChartScheme = 'light' | 'dark'

export interface ChartPaletteEntry {
  /** 低饱和高明度的填充：柱、扇区、面积、图例键。 */
  readonly fill: string
  /** 同色相更深（深色主题里更亮）的描线：折线、标记、轮廓。 */
  readonly ink: string
}

export interface ChartThemeTokens {
  readonly scheme: ChartScheme
  /** 图表所在页面表面色：标记的“镂空”与末点光环使用它。 */
  readonly surface: string
  readonly textPrimary: string
  readonly textSecondary: string
  readonly textMuted: string
  /** 提示框使用反色：深底浅字（深色主题里浅底深字）。 */
  readonly tooltipBackground: string
  readonly tooltipText: string
  readonly fontFamily: string
  readonly palette: readonly ChartPaletteEntry[]
}

function pairs(fills: readonly string[], inks: readonly string[]): readonly ChartPaletteEntry[] {
  if (fills.length !== inks.length) throw new RangeError('Chart palette fills and inks must have the same length')
  return Object.freeze(fills.map((fill, index) => Object.freeze({ fill, ink: inks[index] ?? fill })))
}

type SchemePalettes = Readonly<Record<ChartScheme, readonly ChartPaletteEntry[]>>

/** 绿：Linnya 的品牌色系。深林、奶黄、翠绿、薄荷、橄榄、黄绿、松青、鼠尾草。 */
const VERDANT: SchemePalettes = Object.freeze({
  light: pairs(
    ['#466e4e', '#f3eabd', '#72a88b', '#d3f6ea', '#8c8c62', '#cee4ab', '#4c877d', '#c5d1c7'],
    ['#2c5234', '#82784a', '#3c6b5a', '#54817e', '#564f19', '#638157', '#116468', '#6c7566'],
  ),
  dark: pairs(
    ['#75a67f', '#5e5424', '#569675', '#365a4f', '#969664', '#516528', '#61a89c', '#5c685e'],
    ['#a2d2ab', '#aca16e', '#74b8a5', '#89a192', '#cdc68e', '#9fb37f', '#8cd4cb', '#a6b8a9'],
  ),
})

/** 暖：砖红、淡绿、杏橙、橄榄、玫瑰、奶黄、珊瑚、沙。暖粉彩本来就挤在红黄绿易混区，区分度最弱，靠描线与标注补偿。 */
const WARM: SchemePalettes = Object.freeze({
  light: pairs(
    ['#965851', '#defbe1', '#e0a788', '#94935c', '#e5b6bd', '#f2e8b6', '#c98c84', '#deceb3'],
    ['#70413c', '#618165', '#875c3e', '#51501c', '#895966', '#867649', '#5d3c2e', '#796c57'],
  ),
  dark: pairs(
    ['#ca837a', '#3b573e', '#9e6343', '#939250', '#8b5b64', '#61561e', '#b26f66', '#716045'],
    ['#f1b2aa', '#83a587', '#cf9f7c', '#c8c895', '#d8a2ad', '#aea36c', '#d9ac97', '#beb08d'],
  ),
})

/** 蓝青：靛蓝、天蓝、青、粉蓝、钢蓝、湖青、薄荷、石板。 */
const AQUA: SchemePalettes = Object.freeze({
  light: pairs(
    ['#485e84', '#abd5ee', '#659e9c', '#dbe0f8', '#6283ad', '#91c4d4', '#dbffed', '#a2abbd'],
    ['#2f4266', '#4a7893', '#015955', '#515a71', '#225573', '#2e6a7a', '#4f846e', '#444d60'],
  ),
  dark: pairs(
    ['#7e99c9', '#3d6a84', '#569996', '#525467', '#69b3d1', '#407a8b', '#215942', '#727b8f'],
    ['#aac5f6', '#89bad7', '#8fd8cc', '#939bb1', '#aed1df', '#87cdde', '#6ea78c', '#bbbfd5'],
  ),
})

export const CHART_PALETTES: Readonly<Record<MarkdownChartPalette, SchemePalettes>> = Object.freeze({
  verdant: VERDANT,
  warm: WARM,
  aqua: AQUA,
})

/** 文字与提示框颜色缺失时的保守值，仅用于测试环境和样式尚未解析的瞬间。 */
export const FALLBACK_CHART_THEME: Readonly<Record<ChartScheme, Omit<ChartThemeTokens, 'palette'>>> = Object.freeze({
  light: {
    scheme: 'light',
    surface: '#ffffff',
    textPrimary: '#171717',
    textSecondary: '#494949',
    textMuted: '#737373',
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
  return { ...FALLBACK_CHART_THEME[scheme], palette: CHART_PALETTES[palette][scheme] }
}
