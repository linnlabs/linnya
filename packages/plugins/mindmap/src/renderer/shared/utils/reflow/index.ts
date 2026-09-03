/**
 * ReflowScheduler 模块导出
 *
 * 中文说明：
 * - 这是 MindMap 的核心基础设施，统一管理"尺寸变化 -> 连线重算"的调度
 * - 所有 UI/feature 都应通过 mind.requestReflow() 触发重算，而非直接调用 linkDiv()
 */
export {
  installMindMapReflowScheduler,
  type ReflowScheduler,
  type ReflowSchedulerOptions,
  type ReflowReason,
} from './ReflowScheduler'
