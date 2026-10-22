/**
 * @file chartOption.ts
 * @description 本 feature 向 ECharts 提交的 option 类型。
 *
 * 只做类型导入，不触发运行时加载；真正的 ECharts 模块按图表家族在 orchestration 层延迟加载。
 */

import type { ComposeOption } from 'echarts/core'
import type {
  BarSeriesOption,
  LineSeriesOption,
  PieSeriesOption,
  RadarSeriesOption,
  ScatterSeriesOption,
} from 'echarts/charts'
import type {
  AriaComponentOption,
  GridComponentOption,
  RadarComponentOption,
  TooltipComponentOption,
} from 'echarts/components'

export type ChartOption = ComposeOption<
  | BarSeriesOption
  | LineSeriesOption
  | PieSeriesOption
  | RadarSeriesOption
  | ScatterSeriesOption
  | AriaComponentOption
  | GridComponentOption
  | RadarComponentOption
  | TooltipComponentOption
>
