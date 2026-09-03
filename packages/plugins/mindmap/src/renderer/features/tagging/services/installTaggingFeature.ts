import type { MindMapInstance, NodeObj, NodeTagging } from '../../../domain/types'
import { getNodeAddonsRegistry } from '../../../presentation/addons/nodeAddonsRegistry'
import TaggingBadgeAddon from '../ui/TaggingBadgeAddon.vue'
import { useMindMapTaggingStore, NodeStatusValues } from '../domain/store/taggingStore'
import { installFeatureLifecycle } from '../../shared/installFeatureLifecycle'
import { toDomNodeId } from '../../../shared/utils/dom/nodeId'
import type { Operation } from '../../../shared/utils/events/eventBus'

/**
 * 安装 Tagging Feature
 *
 * 中文说明：
 * - 统一管理 Tagging Feature 的副作用：lifecycle 监听、addon 注册、DOM 属性注入
 * - 返回 dispose，供 MindMap 生命周期结束时清理
 *
 * 设计原则（高内聚低耦合）：
 * - 只做"副作用编排"，业务逻辑在 taggingStore
 * - 通过 NodeAddonsRegistry 渲染 UI，不自己 Teleport/查 DOM
 * - 与 evidence feature 通过事件总线通信，不直接依赖
 * - DOM 属性注入与 CSS 样式配合实现视觉效果
 */
export function installMindMapTaggingFeature(mind: MindMapInstance): () => void {
  const taggingStore = useMindMapTaggingStore()
  let currentDocId: string | null = null

  /**
   * 将 tagging 状态注入到 DOM 节点的 data 属性
   *
   * 中文说明：
   * - 在 structureReady 时调用
   * - 设置 data-tagging-status 属性，供 CSS 样式使用
   * - 保持与核心渲染逻辑解耦
   */
  function injectTaggingAttributesToDOM(m: MindMapInstance) {
    const mapEl = m.map
    if (!mapEl) return

    const taggingData = taggingStore.taggingByNodeId
    let injectedCount = 0

    // 中文说明：先清理所有旧的 tagging 属性（避免状态残留）
    const allNodes = mapEl.querySelectorAll('mm-node[data-tagging-status]')
    allNodes.forEach(node => {
      node.removeAttribute('data-tagging-status')
      node.removeAttribute('data-tagging-confidence')
    })

    // 中文说明：遍历所有有 tagging 的节点，注入 DOM 属性
    for (const [nodeId, tagging] of Object.entries(taggingData)) {
      if (!tagging.status && !tagging.confidence) continue

      const domId = toDomNodeId(nodeId)
      // 中文说明：mm-node 的 data-nodeid 是 DOM ID 格式
      const nodeEl = mapEl.querySelector(`mm-node[data-nodeid="${domId}"]`)
      if (!nodeEl) continue

      if (tagging.status) {
        nodeEl.setAttribute('data-tagging-status', tagging.status)
      }
      if (tagging.confidence !== undefined) {
        const confValue = typeof tagging.confidence === 'number'
          ? String(tagging.confidence)
          : tagging.confidence
        nodeEl.setAttribute('data-tagging-confidence', confValue)
      }
      injectedCount++
    }

    if (injectedCount > 0) {
      console.log('[installTaggingFeature] injectTaggingAttributesToDOM', {
        injectedCount,
      })
    }
  }

  /**
   * 增量更新单个节点的 tagging data 属性
   *
   * 中文说明：
   * - `node.setKind` 通过 operation.reshapeNode 即时修改 nodeObj.tagging
   * - status/confidence 的 CSS 依赖 data-tagging-*，因此需要同步更新（否则需 reload 才生效）
   * - 这里仅更新目标节点，避免每次操作都全量扫 DOM
   */
  function applyTaggingAttributesToNode(m: MindMapInstance, nodeId: string, tagging: NodeTagging | undefined) {
    const mapEl = m.map
    if (!mapEl) return
    if (!nodeId) return

    const domId = toDomNodeId(nodeId)
    const nodeEl = mapEl.querySelector(`mm-node[data-nodeid="${domId}"]`)
    if (!nodeEl) return

    const status = tagging?.status
    const confidence = tagging?.confidence

    if (typeof status === 'string' && status.length > 0) {
      nodeEl.setAttribute('data-tagging-status', status)
    } else {
      nodeEl.removeAttribute('data-tagging-status')
    }

    if (!(confidence === undefined || confidence === null)) {
      const confValue = typeof confidence === 'number' ? String(confidence) : confidence
      nodeEl.setAttribute('data-tagging-confidence', confValue)
    } else {
      nodeEl.removeAttribute('data-tagging-confidence')
    }
  }

  function snapshotTagging(tagging: NodeTagging | undefined): {
    status?: string
    confidence?: string | number
    kind?: string
  } {
    const status = typeof tagging?.status === 'string' ? tagging.status : undefined
    const confidence = tagging?.confidence
    const rawKind = tagging?.labels?.kind
    const kind = typeof rawKind === 'string' ? rawKind : undefined
    return { status, confidence, kind }
  }

  // =========================================================================
  // Lifecycle 管理
  // =========================================================================

  const disposeLifecycle = installFeatureLifecycle(mind, {
    featureName: 'tagging:badge',
    awaitNextTickOnStructureReady: true,

    /**
     * 文档 ready 时重置缓存
     */
    onDocumentReady: ({ documentId }, payload) => {
      const prevDocId = currentDocId
      currentDocId = documentId

      /**
       * 缓存重置策略
       * 中文说明：
       * - switch（切换文档）：必须 reset，避免旧文档数据污染新文档
       * - reload（同一 documentId）：禁止 reset，避免 UI 闪烁（数据会在 structureReady 重建）
       * - 对齐 Evidence Feature 的缓存策略
       */
      const isDocSwitch = payload.reason === 'switch' || (prevDocId !== null && prevDocId !== documentId)

      if (isDocSwitch) {
        taggingStore.resetCache()
      }
      console.log('[installTaggingFeature] documentReady', {
        documentId,
        isDocSwitch,
        reason: payload.reason,
      })
    },

    /**
     * 结构 ready 时从 nodeData 重建缓存并注入 DOM 属性
     */
    onStructureReady: ({ mind: m, documentId }, payload) => {
      const nodeData = m.nodeData as NodeObj | null
      taggingStore.buildCacheFromNodeData(nodeData)

      const taggedCount = taggingStore.taggedNodeCount
      if (taggedCount > 0) {
        console.log('[installTaggingFeature] structureReady', {
          documentId,
          structureRevision: payload.structureRevision,
          taggedNodeCount: taggedCount,
          refutedNodeCount: taggingStore.refutedNodeCount,
        })

        // 中文说明：注入 DOM 属性，供 CSS 样式使用
        injectTaggingAttributesToDOM(m)
      }

      // 中文说明：tagging 变化会触发 addon 渲染/消失，需要做一次几何重算保证连线正确
      m.requestReflow('addons:content')
    },
  })

  // =========================================================================
  // Addon 注册
  // =========================================================================

  const registry = getNodeAddonsRegistry(mind)

  const disposeAddon = registry.register({
    id: 'tagging:badge',
    /**
     * 渲染顺序：在 evidence:reference (100) 之前
     *
     * 中文说明：
     * - Tagging badge 应该在引用预览之前显示
     * - 用户先看状态，再看证据
     */
    order: 50,
    component: TaggingBadgeAddon,

    /**
     * 依赖追踪
     *
     * 中文说明：
     * - 显式声明依赖 taggingByNodeId，保证状态变化时 Host 能稳定重算 renderItems
     */
    track: () => {
      // 中文说明：访问 taggingByNodeId 建立响应式依赖
      void taggingStore.taggingByNodeId
    },

    /**
     * 渲染条件
     *
     * 中文说明：
     * - 只有当节点有 tagging 且不是纯 open 状态时才渲染
     * - open 状态是默认态，不需要显示
     */
    shouldRender: ({ nodeId }) => {
      const tagging = taggingStore.getTagging(nodeId)
      if (!tagging) return false

      const { status, confidence, labels } = tagging
      const kind = labels?.kind
      const hasKind = typeof kind === 'string' && kind.length > 0

      // open 是默认态：若仅 open 且没有置信度/类型，则不渲染
      const hasConfidence = !(confidence === undefined || confidence === null)
      if (status === NodeStatusValues.OPEN && !hasConfidence && !hasKind) return false

      return Boolean(status || hasConfidence || hasKind)
    },
  })

  // =========================================================================
  // 实时刷新：命令/operation 驱动（node.setKind 等）
  // =========================================================================

  /**
   * 监听 reshapeNode operation，增量刷新 tagging 缓存
   *
   * 中文说明（根因修复）：
   * - `node.setKind` 通过 `mind.reshapeNode()` 修改 nodeObj.tagging，并 fire operation.reshapeNode
   * - Tagging UI 读取的是 taggingStore 的缓存，而缓存此前只在 structureReady 重建一次
   * - 因此需要在 reshapeNode 时做“单节点级 upsert”，实现实时刷新
   */
  const handleOperation = (op: Operation) => {
    if (op.name !== 'reshapeNode') return

    const nodeId = op.obj?.id
    if (!nodeId) return

    const prev = snapshotTagging(op.origin?.tagging)
    const next = snapshotTagging(op.obj?.tagging)

    // 如果 tagging 语义未变化，则不触发缓存/DOM 更新（避免噪声与不必要 reflow）
    if (
      prev.status === next.status &&
      prev.confidence === next.confidence &&
      prev.kind === next.kind
    ) {
      return
    }

    taggingStore.upsertTagging(nodeId, op.obj.tagging)
    applyTaggingAttributesToNode(mind, nodeId, op.obj.tagging)

    // 中文说明：tagging UI 变化可能影响节点高度（addons 出现/消失），需触发一次几何重算
    mind.requestReflow('addons:content')
  }
  mind.bus.addListener('operation', handleOperation)

  // =========================================================================
  // Dispose
  // =========================================================================

  return () => {
    mind.bus.removeListener('operation', handleOperation)
    disposeLifecycle()
    disposeAddon()
    console.log('[installTaggingFeature] disposed')
  }
}
