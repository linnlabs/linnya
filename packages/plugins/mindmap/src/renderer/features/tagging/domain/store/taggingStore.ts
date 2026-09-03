import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { NodeObj, NodeTagging } from '../../../../domain/types'

/**
 * 节点状态推荐值
 *
 * 中文说明：
 * - 存储值使用小写，UI 展示时映射为中文/图标
 * - 允许扩展：工具可写入未知值，UI 需有兜底呈现
 */
export const NodeStatusValues = {
  OPEN: 'open',
  VERIFIED: 'verified',
  REFUTED: 'refuted',
  CLOSED: 'closed',
} as const

export type NodeStatusValue = (typeof NodeStatusValues)[keyof typeof NodeStatusValues]

/**
 * 置信度推荐值
 */
export const ConfidenceValues = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
} as const

export type ConfidenceValue = (typeof ConfidenceValues)[keyof typeof ConfidenceValues]

/**
 * 状态展示配置
 *
 * 中文说明：
 * - label：UI 展示文案
 * - className：CSS 类名后缀（用于样式区分）
 * - icon：可选图标标识（用于扩展）
 */
export interface StatusDisplayConfig {
  label: string
  className: string
  icon?: string
  color?: string
}

/**
 * 状态展示映射
 */
export const STATUS_DISPLAY_MAP: Record<NodeStatusValue, StatusDisplayConfig> = {
  [NodeStatusValues.OPEN]: {
    label: '待验证',
    className: 'open',
  },
  [NodeStatusValues.VERIFIED]: {
    label: '已证实',
    className: 'verified',
    color: 'var(--color-success)',
  },
  [NodeStatusValues.REFUTED]: {
    label: '已证伪',
    className: 'refuted',
    color: 'var(--color-error)',
  },
  [NodeStatusValues.CLOSED]: {
    label: '已关闭',
    className: 'closed',
    color: 'var(--color-text-tertiary)',
  },
}

/**
 * 置信度展示映射
 */
export const CONFIDENCE_DISPLAY_MAP: Record<ConfidenceValue, { label: string; className: string }> = {
  [ConfidenceValues.HIGH]: { label: '高置信度', className: 'high' },
  [ConfidenceValues.MEDIUM]: { label: '中等置信度', className: 'medium' },
  [ConfidenceValues.LOW]: { label: '低置信度', className: 'low' },
}

/**
 * 节点打标状态缓存条目
 */
export interface NodeTaggingCacheEntry {
  tagging: NodeTagging
  updatedAt: number
}

/**
 * MindMap Tagging Store
 *
 * 中文说明：
 * - 这是 Tagging Feature 的状态容器
 * - 只做"从 mind.nodeData 派生 UI 状态"的缓存
 * - 不做业务逻辑：打标写入由后端工具完成，前端只读取和展示
 *
 * 设计原则（高内聚低耦合）：
 * - 单一职责：只管理 tagging 状态的读取和缓存
 * - 纯派生：数据来源是 mind.nodeData，不维护独立状态
 * - 响应式：支持 Vue 组件的依赖追踪
 */
export const useMindMapTaggingStore = defineStore('mindmap-tagging', () => {
  // =========================================================================
  // State
  // =========================================================================

  /**
   * 节点打标缓存：nodeId -> tagging
   *
   * 中文说明：
   * - 从 mind.nodeData 提取并缓存，避免每次渲染都遍历树
   * - 在 structureReady 时重建
   */
  const taggingByNodeId = ref<Record<string, NodeTagging>>({})

  /**
   * 缓存更新时间戳（用于调试/可观测）
   */
  const lastCacheUpdateAt = ref<number>(0)

  // =========================================================================
  // Computed
  // =========================================================================

  /**
   * 有打标状态的节点数量
   */
  const taggedNodeCount = computed(() => {
    return Object.keys(taggingByNodeId.value).filter(nodeId => {
      const t = taggingByNodeId.value[nodeId]
      return t && (t.status || t.confidence || t.labels)
    }).length
  })

  /**
   * Refuted 节点数量（用于全局统计/提示）
   */
  const refutedNodeCount = computed(() => {
    return Object.values(taggingByNodeId.value).filter(
      t => t?.status === NodeStatusValues.REFUTED
    ).length
  })

  // =========================================================================
  // Actions
  // =========================================================================

  /**
   * 增量更新某个节点的 tagging（用于命令/operation 的实时刷新）
   *
   * 中文说明：
   * - 以前 tagging 缓存只在 structureReady 重建一次；但 `node.setKind` 这类命令会通过 `reshapeNode`
   *   即时修改 nodeObj.tagging，用户期望 UI 立即刷新，而不是等 reload。
   * - 这里提供一个“单节点级”的 upsert，避免每次都全树 traverse（更高内聚、开销可控）。
   *
   * @param nodeId 业务 nodeId
   * @param tagging 新的 tagging；传 undefined 表示移除
   */
  function upsertTagging(nodeId: string, tagging: NodeTagging | undefined) {
    if (!nodeId) return
    const prev = taggingByNodeId.value
    const next: Record<string, NodeTagging> = { ...prev }
    if (tagging) {
      next[nodeId] = tagging
    } else {
      delete next[nodeId]
    }
    taggingByNodeId.value = next
    lastCacheUpdateAt.value = Date.now()
  }

  /**
   * 重置缓存
   *
   * 中文说明：
   * - 在文档切换/重载时调用
   * - 避免旧文档数据污染新文档
   */
  function resetCache() {
    taggingByNodeId.value = {}
    lastCacheUpdateAt.value = 0
    console.log('[TaggingStore] resetCache')
  }

  /**
   * 从 nodeData 树提取并缓存所有 tagging
   *
   * 中文说明：
   * - 在 structureReady 时调用
   * - 递归遍历整棵树，提取有 tagging 的节点
   */
  function buildCacheFromNodeData(rootNode: NodeObj | null) {
    if (!rootNode) {
      taggingByNodeId.value = {}
      lastCacheUpdateAt.value = Date.now()
      return
    }

    const cache: Record<string, NodeTagging> = {}

    function traverse(node: NodeObj) {
      if (node.tagging) {
        cache[node.id] = node.tagging
      }
      node.children?.forEach(traverse)
    }

    traverse(rootNode)
    taggingByNodeId.value = cache
    lastCacheUpdateAt.value = Date.now()

    const taggedCount = Object.keys(cache).length
    if (taggedCount > 0) {
      console.log('[TaggingStore] buildCacheFromNodeData', {
        taggedNodeCount: taggedCount,
        sampleNodes: Object.entries(cache).slice(0, 3).map(([nodeId, t]) => ({
          nodeId: nodeId.slice(0, 8),
          status: t.status,
          confidence: t.confidence,
        })),
      })
    }
  }

  // =========================================================================
  // Selectors
  // =========================================================================

  /**
   * 获取节点的 tagging（可能为 undefined）
   */
  function getTagging(nodeId: string): NodeTagging | undefined {
    return taggingByNodeId.value[nodeId]
  }

  /**
   * 获取节点状态（带兜底）
   */
  function getStatus(nodeId: string): string | undefined {
    return taggingByNodeId.value[nodeId]?.status
  }

  /**
   * 获取节点置信度（带兜底）
   */
  function getConfidence(nodeId: string): string | number | undefined {
    return taggingByNodeId.value[nodeId]?.confidence
  }

  /**
   * 判断节点是否为 Refuted 状态
   */
  function isRefuted(nodeId: string): boolean {
    return getStatus(nodeId) === NodeStatusValues.REFUTED
  }

  /**
   * 判断节点是否有任何打标信息
   */
  function hasTagging(nodeId: string): boolean {
    const t = taggingByNodeId.value[nodeId]
    return Boolean(t && (t.status || t.confidence || t.labels))
  }

  /**
   * 获取状态展示配置（含兜底）
   *
   * 中文说明：
   * - 已知状态返回预定义配置
   * - 未知状态返回兜底配置（显示原始值）
   */
  function getStatusDisplayConfig(status: string | undefined): StatusDisplayConfig | null {
    if (!status) return null

    const known = STATUS_DISPLAY_MAP[status as NodeStatusValue]
    if (known) return known

    // 兜底：未知状态也展示，保持可观测
    return {
      label: status,
      className: 'unknown',
    }
  }

  /**
   * 获取置信度展示配置（含兜底）
   */
  function getConfidenceDisplayConfig(confidence: string | number | undefined): { label: string; className: string } | null {
    if (confidence === undefined || confidence === null) return null

    if (typeof confidence === 'string') {
      const known = CONFIDENCE_DISPLAY_MAP[confidence as ConfidenceValue]
      if (known) return known
      // 兜底：未知置信度字符串
      return { label: confidence, className: 'unknown' }
    }

    // number 类型置信度
    if (typeof confidence === 'number') {
      // 0-1 范围映射为百分比
      if (confidence >= 0 && confidence <= 1) {
        return { label: `${Math.round(confidence * 100)}%`, className: 'numeric' }
      }
      // 其他数值直接展示
      return { label: String(confidence), className: 'numeric' }
    }

    return null
  }

  return {
    // State
    taggingByNodeId,
    lastCacheUpdateAt,

    // Computed
    taggedNodeCount,
    refutedNodeCount,

    // Actions
    resetCache,
    buildCacheFromNodeData,
    upsertTagging,

    // Selectors
    getTagging,
    getStatus,
    getConfidence,
    isRefuted,
    hasTagging,
    getStatusDisplayConfig,
    getConfidenceDisplayConfig,
  }
})
