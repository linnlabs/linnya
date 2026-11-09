/**
 * chart-reading 特性模块出口：图表的只读呈现与会话级阅读交互。
 *
 * 这里只暴露外壳组件、阅读状态键、会话清理与静态打印入口；ECharts 运行时、主题解析和阅读规则
 * 都是模块内部实现，其他模块不应绕过出口直接引用。
 */

export { default as ChartSurface } from './ui/ChartSurface.vue'
export type { ChartReadingKey, ChartReadingVariant } from '@linnya/markdown-document-core/workspace-charts'
export {
  createChartReadingSessionId,
  disposeChartReadingBlock,
  disposeChartReadingSession,
} from './orchestration/chartReadingSessions'
export {
  buildChartDataTable,
  chartDataTableToTsv,
  type ChartDataTableLabels,
  type ChartDataTableModel,
} from './functions/chartDataTable'

export { plotHeightOf } from '@linnya/markdown-document-core/workspace-charts'
export { resolveLegendPosition } from '@linnya/markdown-document-core/workspace-charts'
export { renderChartPrintImage } from './orchestration/renderChartPrintImage'
