/**
 * @file chartRuntime.ts
 * @description ECharts 运行时的延迟加载：core 与 SVG 渲染器一次，其余按图表家族加载。
 *
 * ECharts 不进入首屏同步依赖：只有文档里出现图表并进入可见/预热区域时才会 `import()`。
 * 家族注册是幂等的；加载失败会清除缓存，允许下一次重试，而不是永久卡在失败的 Promise 上。
 */

import type { MarkdownChartType } from '@app/schemas'

export type ChartRuntime = (typeof import('./runtime/echartsCoreRuntime'))['echarts']

type ChartFamily = 'cartesian' | 'scatter' | 'share' | 'radar'

export function chartFamilyOf(chartType: MarkdownChartType): ChartFamily {
  switch (chartType) {
    case 'pie':
    case 'doughnut':
      return 'share'
    case 'scatter':
      return 'scatter'
    case 'radar':
      return 'radar'
    default:
      return 'cartesian'
  }
}

const familyLoads = new Map<ChartFamily, Promise<unknown>>()

function importFamily(family: ChartFamily): Promise<unknown> {
  switch (family) {
    case 'cartesian':
      return import('./runtime/registerCartesianRuntime')
    case 'scatter':
      return import('./runtime/registerScatterRuntime')
    case 'share':
      return import('./runtime/registerShareRuntime')
    case 'radar':
      return import('./runtime/registerRadarRuntime')
  }
}

export async function loadChartRuntime(chartType: MarkdownChartType): Promise<ChartRuntime> {
  const core = await import('./runtime/echartsCoreRuntime')
  const family = chartFamilyOf(chartType)
  let load = familyLoads.get(family)
  if (!load) {
    load = importFamily(family)
    familyLoads.set(family, load)
  }
  try {
    await load
  } catch (error) {
    familyLoads.delete(family)
    throw error
  }
  return core.echarts
}
