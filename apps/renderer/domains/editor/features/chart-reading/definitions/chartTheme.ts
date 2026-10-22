/**
 * @file chartTheme.ts
 * @description 图表主题合同：分类色板与随主题变化的文字、网格、表面颜色。
 *
 * 色板是经过校验的 8 色分类序列（slot 顺序固定，不循环生成新色相）。亮/暗各一组步长，
 * 在 `#ffffff` 亮表面、`#171717`/`#262626` 暗表面上通过相邻 CVD、正常视觉与明度/彩度门禁；
 * 亮色模式下青、黄、洋红三色对比度低于 3:1，因此图表始终提供数据表和可见的数值入口作为补偿。
 */

export type ChartScheme = 'light' | 'dark'

export interface ChartThemeTokens {
  readonly scheme: ChartScheme
  /** 图表所在页面表面色：标记环、堆叠间隙都使用它，而不是描边。 */
  readonly surface: string
  readonly textPrimary: string
  readonly textSecondary: string
  readonly textMuted: string
  /** 网格线：比表面深一档的发丝线。 */
  readonly grid: string
  /** 基线与轴线。 */
  readonly axisLine: string
  readonly tooltipBackground: string
  readonly tooltipBorder: string
  readonly fontFamily: string
  readonly palette: readonly string[]
}

/** 蓝、橙、青、黄、洋红、绿、紫、红。顺序即 CVD 安全机制，不可调换。 */
export const CHART_CATEGORICAL_PALETTE: Readonly<Record<ChartScheme, readonly string[]>> = Object.freeze({
  light: Object.freeze(['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']),
  dark: Object.freeze(['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']),
})

/** 文字颜色缺失时的保守值，仅用于测试环境和样式尚未解析的瞬间。 */
export const FALLBACK_CHART_THEME: Readonly<Record<ChartScheme, Omit<ChartThemeTokens, 'palette'>>> = Object.freeze({
  light: {
    scheme: 'light',
    surface: '#ffffff',
    textPrimary: '#171717',
    textSecondary: '#494949',
    textMuted: '#737373',
    grid: '#e5e5e5',
    axisLine: '#d4d4d4',
    tooltipBackground: '#ffffff',
    tooltipBorder: '#d4d4d4',
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
  dark: {
    scheme: 'dark',
    surface: '#171717',
    textPrimary: '#ededed',
    textSecondary: '#bcbcbc',
    textMuted: '#8b8b8b',
    grid: '#333333',
    axisLine: '#4d4d4d',
    tooltipBackground: '#2d2d2d',
    tooltipBorder: '#4d4d4d',
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
})

/** 不读取 DOM 的基础主题：图例颜色、测试和样式尚未解析时使用。 */
export function baseChartTheme(scheme: ChartScheme): ChartThemeTokens {
  return { ...FALLBACK_CHART_THEME[scheme], palette: CHART_CATEGORICAL_PALETTE[scheme] }
}
