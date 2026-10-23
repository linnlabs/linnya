/**
 * @file chartInstanceController.ts
 * @description 一个 ECharts 实例的生命周期：创建、受控更新、高亮、重绘与释放。
 *
 * 设计约束：
 * - 实例只在需要时存在（块可见/预热时创建，离屏释放）；阅读状态由 store 持有，与实例存活无关。
 * - 异步加载运行时期间，如果控制器已释放或规格已更新，旧结果不得重新挂回。
 * - 更新用 `replaceMerge` 明确替换系列与坐标轴，清除被删除的系列；不播放过渡时完全重建 option，清除被省略的旧属性。
 * - 本文件不决定“是否播放过渡”（由调用方依据 `canTransitionBetween` 与读者操作传入）。
 */

import type { MarkdownChartSpecReadView } from '@app/schemas'
import type { EChartsType } from 'echarts/core'
import type { ChartReadingState } from '../definitions/chartReadingState'
import type { ChartHighlightTarget, ChartOptionMessages } from '../definitions/chartRender'
import type { ChartThemeTokens } from '../definitions/chartTheme'
import { plotHeightOf } from '../functions/chartLayout'
import { buildChartOption } from '../functions/option/buildChartOption'
import { chartFamilyOf, loadChartRuntime } from './chartRuntime'

export interface ChartControllerInput {
  readonly spec: MarkdownChartSpecReadView
  readonly state: ChartReadingState
  readonly theme: ChartThemeTokens
  readonly locale: string
  readonly messages: ChartOptionMessages
  /** 本次更新是否播放短过渡。首次渲染、主题/尺寸变化与再次入屏必须为 false。 */
  readonly transition: boolean
}

export interface ChartController {
  render(input: ChartControllerInput): Promise<void>
  highlight(target: ChartHighlightTarget | null): void
  dispose(): void
  readonly isDisposed: boolean
}

let liveInstanceCount = 0

/** 当前存活的 ECharts 实例数：用于验证“离屏释放、实例数受可见范围约束”。 */
export function getLiveChartInstanceCount(): number {
  return liveInstanceCount
}

const MIN_PLOT_WIDTH = 160

/** 只能替换当前已注册家族的组件类型，否则 ECharts 会拒绝 `replaceMerge`。 */
function replacedComponentsFor(chartType: MarkdownChartSpecReadView['chartType']): ('series' | 'xAxis' | 'yAxis' | 'radar')[] {
  switch (chartType) {
    case 'pie':
    case 'doughnut':
      return ['series']
    case 'radar':
      return ['series', 'radar']
    default:
      return ['series', 'xAxis', 'yAxis']
  }
}

export function createChartController(host: HTMLElement): ChartController {
  let instance: EChartsType | null = null
  let renderedType: string | null = null
  let renderedFamily: string | null = null
  let generation = 0
  let disposed = false

  const measure = (spec: MarkdownChartSpecReadView) => ({
    width: Math.max(MIN_PLOT_WIDTH, Math.round(host.clientWidth)),
    height: plotHeightOf(spec),
  })

  async function render(input: ChartControllerInput): Promise<void> {
    if (disposed) return
    const token = ++generation
    const echarts = await loadChartRuntime(input.spec.chartType)
    // 加载期间可能已被释放或被更新的规格取代：旧结果不得重新挂回。
    if (disposed || token !== generation) return

    const size = measure(input.spec)
    // ECharts 实例只使用它初始化时已注册的图表家族；跨家族切换必须用新实例，否则布局/视觉阶段缺失。
    const family = chartFamilyOf(input.spec.chartType)
    if (instance && family !== renderedFamily) {
      instance.dispose()
      instance = null
      liveInstanceCount -= 1
      renderedType = null
    }
    if (!instance) {
      instance = echarts.init(host, undefined, { renderer: 'svg', width: size.width, height: size.height })
      liveInstanceCount += 1
    } else {
      // 筛选可能移除正在悬停的系列，先清掉旧高亮，避免其 blur 状态污染更新后的视图。
      instance.dispatchAction({ type: 'downplay' })
      instance.resize({ width: size.width, height: size.height, animation: { duration: 0 } })
    }

    const option = buildChartOption(input.spec, input.state, {
      theme: input.theme,
      locale: input.locale,
      messages: input.messages,
      plotWidth: size.width,
      plotHeight: size.height,
      intent: 'reading',
      transition: input.transition,
    })
    const typeChanged = renderedType !== null && renderedType !== input.spec.chartType
    instance.setOption(option, {
      notMerge: renderedType === null || typeChanged || !input.transition,
      replaceMerge: replacedComponentsFor(input.spec.chartType),
      lazyUpdate: false,
    })
    renderedType = input.spec.chartType
    renderedFamily = family
  }

  return {
    render,
    highlight(target) {
      if (!instance) return
      instance.dispatchAction({ type: 'downplay' })
      if (target === null) return
      if (target.kind === 'part') {
        instance.dispatchAction({ type: 'highlight', seriesIndex: 0, dataIndex: target.index })
      } else if (renderedType === 'radar') {
        // 雷达只有一个系列，每条轮廓是它的一个数据项，数据项名即系列名。
        instance.dispatchAction({ type: 'highlight', seriesIndex: 0, name: target.name })
      } else {
        instance.dispatchAction({ type: 'highlight', seriesName: target.name })
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      generation += 1
      if (instance) {
        instance.dispose()
        instance = null
        liveInstanceCount -= 1
      }
    },
    get isDisposed() {
      return disposed
    },
  }
}
