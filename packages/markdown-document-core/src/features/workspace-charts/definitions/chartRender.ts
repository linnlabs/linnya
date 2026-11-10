/**
 * @file chartRender.ts
 * @description 一次渲染所需的上下文：主题、语言环境、文案与版面尺寸。
 *
 * option 构建函数只读这个上下文，不读取 DOM、store 或窗口，因此同一份规格与上下文总得到同一份 option，
 * 阅读渲染、编辑预览和默认视图导出共用同一套映射。
 */

import type { ChartThemeTokens } from './chartTheme'

/** option 内部直接出现的文案（图例之外）。由调用方按当前语言解析后传入。 */
export interface ChartOptionMessages {
  /** 次轴系列的标注，例如“右轴”。 */
  readonly secondaryAxis: string
  /** 百分比堆叠 tooltip 中的“占整体”。 */
  readonly shareOfWhole: string
  /** 饼/环 tooltip 中的“占比”。 */
  readonly share: string
}

/**
 * - `reading`：正文/预览中的交互渲染。
 * - `export`：默认视图的静态输出（复制为图片、SSR）：无 tooltip、无动画、无高亮状态。
 */
export type ChartRenderIntent = 'reading' | 'export'

export interface ChartRenderContext {
  readonly theme: ChartThemeTokens
  readonly locale: string
  readonly messages: ChartOptionMessages
  readonly plotWidth: number
  readonly plotHeight: number
  readonly intent: ChartRenderIntent
  /** 本次是否播放更新过渡。首次渲染、主题/尺寸变化与再次入屏一律为 false。 */
  readonly transition: boolean
}
