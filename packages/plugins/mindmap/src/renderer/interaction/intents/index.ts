/**
 * MindMap Intent 体系 — 模块导出
 *
 * 中文说明：
 * - 统一导出 Intent 相关的类型、工具、组件
 * - 作为 Phase 2 交互收敛的核心基础设施
 *
 * @module interaction/intents
 */

// 类型导出
export type {
  // 来源
  IntentSource,
  // 元信息
  IntentMeta,
  // 名称
  IntentName,
  NodeIntentName,
  SelectionIntentName,
  CanvasIntentName,
  UIIntentName,
  ArrowIntentName,
  SummaryIntentName,
  // Payloads
  IntentPayloads,
  NodeIntentPayloads,
  SelectionIntentPayloads,
  CanvasIntentPayloads,
  UIIntentPayloads,
  ArrowIntentPayloads,
  SummaryIntentPayloads,
  // Intent 对象
  Intent,
  // Handler
  IntentHandleResult,
  IntentHandler,
} from './types'

// 工具函数导出
export {
  // 来源转换
  intentSourceToCommandSource,
  // traceId 生成
  generateTraceId,
  // Meta 创建
  createIntentMeta,
  // Intent 创建
  createIntent,
  // 类型守卫
  isNodeIntent,
  isSelectionIntent,
  isCanvasIntent,
  isUIIntent,
  isArrowIntent,
  isSummaryIntent,
} from './types'

// Logger 导出
export type { IntentLogLevel, IntentLoggerConfig, IntentLogEntry } from './intentLogger'

export { getIntentLogger, configureIntentLogger } from './intentLogger'

// Dispatcher 导出
export { IntentDispatcher, createIntentDispatcher } from './intentDispatcher'

// Router 导出
export type { RouteResult } from './intentRouter'

export {
  IntentRouter,
  createIntentRouter,
  routeClickToIntent,
  routeDblClickToIntent,
  routeWheelToIntent,
} from './intentRouter'
