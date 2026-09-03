import { nextTick } from 'vue'
import type { MindMapInstance } from '../../domain/types'
import type { EventMap } from '../../shared/utils/events/eventBus'

type DocumentReadyPayload = Parameters<EventMap['lifecycle:documentReady']>[0]
type StructureReadyPayload = Parameters<EventMap['lifecycle:structureReady']>[0]
type GeometryFlushedPayload = Parameters<EventMap['lifecycle:geometryFlushed']>[0]

export type InstallFeatureLifecycleOptions = {
  /**
   * feature 名称（用于日志前缀）
   */
  featureName: string

  /**
   * 结构 ready 回调前是否等待 nextTick
   *
   * 中文说明：
   * - 一些 feature 会在 structureReady 后立刻扫描 DOM / 读取布局，
   *   nextTick 可以保证 Vue 的 patch 阶段先完成，减少“DOM 还没稳定”的抖动。
   * - 默认 true：偏稳健。
   */
  awaitNextTickOnStructureReady?: boolean

  /**
   * 当文档上下文 ready 时触发（通常 resetCache / 重置内存状态）
   */
  onDocumentReady?: (ctx: { mind: MindMapInstance; documentId: string }, payload: DocumentReadyPayload) => void

  /**
   * 当结构 ready 时触发（通常初始化 counts / 扫描 nodeData 等）
   *
   * 注意：会自动过滤“非当前文档”的结构事件，避免跨文档误触发。
   */
  onStructureReady?: (
    ctx: { mind: MindMapInstance; documentId: string },
    payload: StructureReadyPayload
  ) => void | Promise<void>

  /**
   * 当几何 flush 时触发（只建议用于观测/埋点，不建议控制逻辑）
   */
  onGeometryFlushed?: (ctx: { mind: MindMapInstance; documentId: string }, payload: GeometryFlushedPayload) => void
}

/**
 * Feature 生命周期安装器（Phase 5）
 *
 * 中文说明：
 * - 把 feature 的“副作用监听”集中在一个入口，统一 document/structure/geometry 三类生命周期信号。
 * - 提供稳定的“当前文档过滤”，避免 feature 自己到处写 if/else 或竞态锁。
 * - 只做“生命周期编排”，不做业务补丁：业务初始化逻辑仍由 feature 自己实现。
 */
export function installFeatureLifecycle(
  mind: MindMapInstance,
  options: InstallFeatureLifecycleOptions
): () => void {
  const { featureName, awaitNextTickOnStructureReady = true } = options

  let currentDocId: string | null = null

  const handleDocumentReady = (payload: DocumentReadyPayload) => {
    currentDocId = payload.documentId
    try {
      options.onDocumentReady?.({ mind, documentId: payload.documentId }, payload)
    } catch (error) {
      console.error(`[installFeatureLifecycle:${featureName}] onDocumentReady failed`, error)
    }
  }

  const handleStructureReady = async (payload: StructureReadyPayload) => {
    // 中文说明：只响应“当前文档”的结构事件，避免跨文档误触发。
    if (!currentDocId) {
      // 若 feature 在 documentReady 之前收到 structureReady，说明外部时序有问题；
      // 这里不做兜底推断，保持可观测：直接忽略并输出日志（开发态才有意义）。
      if (import.meta.env.MODE !== 'production') {
        console.warn(`[installFeatureLifecycle:${featureName}] structureReady ignored: no currentDocId yet`, payload)
      }
      return
    }
    if (payload.documentId !== currentDocId) return

    if (awaitNextTickOnStructureReady) {
      await nextTick()
    }
    try {
      await options.onStructureReady?.({ mind, documentId: currentDocId }, payload)
    } catch (error) {
      console.error(`[installFeatureLifecycle:${featureName}] onStructureReady failed`, error)
    }
  }

  const handleGeometryFlushed = (payload: GeometryFlushedPayload) => {
    if (!currentDocId) return
    try {
      options.onGeometryFlushed?.({ mind, documentId: currentDocId }, payload)
    } catch (error) {
      console.error(`[installFeatureLifecycle:${featureName}] onGeometryFlushed failed`, error)
    }
  }

  mind.bus.addListener('lifecycle:documentReady', handleDocumentReady)
  mind.bus.addListener('lifecycle:structureReady', handleStructureReady)
  mind.bus.addListener('lifecycle:geometryFlushed', handleGeometryFlushed)

  return () => {
    mind.bus.removeListener('lifecycle:documentReady', handleDocumentReady)
    mind.bus.removeListener('lifecycle:structureReady', handleStructureReady)
    mind.bus.removeListener('lifecycle:geometryFlushed', handleGeometryFlushed)
  }
}

