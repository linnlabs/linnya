import type { MindMapInstance } from '../../../domain/types'
import { installMindMapEvidenceSync } from '../domain/sync/evidenceSyncPlugin'
import { getNodeAddonsRegistry } from '../../../presentation/addons/nodeAddonsRegistry'
import ReferenceAddon from '../ui/ReferenceAddon.vue'
import { useMindMapEvidenceStore } from '../domain/store/evidenceStore'
import type { NodeObj } from '../../../domain/types'
import { installFeatureLifecycle } from '../../shared/installFeatureLifecycle'

/**
 * 安装 Evidence Feature
 *
 * 中文说明：
 * - 统一管理“副作用”：before hooks、bus 监听、键盘监听等。
 * - 返回 dispose，供 MindMap 生命周期结束时清理（对齐 editor 的 bootstrap/dispose 风格）。
 */
export function installMindMapEvidenceFeature(mind: MindMapInstance): () => void {
  const disposeSync = installMindMapEvidenceSync(mind)

  const evidenceStore = useMindMapEvidenceStore()

  /**
   * 记录“当前文档 counts 是否已初始化”
   *
   * 根因说明（关键）：
   * - feature 安装发生在 MindMap 实例创建后、文档数据 apply 之前
   * - documentReady（文档上下文就绪）与 structureReady（结构重建完成）不是同一个时序点
   * - 仅依赖其中一个会出现竞态：docId ready 但结构未 ready / 或结构 ready 但 docId 未 ready
   * - 所以这里必须按生命周期信号编排：documentReady 负责 resetCache；structureReady 负责 initCounts
   */
  let currentDocId: string | null = null
  let initedStructureRevision = 0
  /**
   * 下一次 structureReady 是否需要“为已展开节点重拉一次 list”
   *
   * 中文说明：
   * - AutoRefresh 会触发 documentReady(reason='reload') + structureReady；
   * - 若引用列表在刷新前已展开，用户期望刷新后保持展开，并展示最新数据；
   * - 因此在 reload 场景下，structureReady 需要对 expanded 节点执行一次 loadEvidences。
   */
  let shouldReloadExpandedListsOnNextStructureReady = false

  function collectAllNodeIds(node: NodeObj, out: string[]) {
    out.push(node.id)
    node.children?.forEach(child => collectAllNodeIds(child, out))
  }

  /**
   * 初始化 counts（在“文档上下文已就绪”后执行）
   *
   * 根因说明：
   * - loadCounts 依赖 currentDocumentId
   * - MindMap 实例创建时 currentDocumentId 可能尚未 set（setDocumentSession 由 adapter 异步调用）
   * - 必须监听 documentId 变化，在真正就绪后再 loadCounts，否则会出现“重启后引用消失”
   */
  async function initCountsForStructureReady(structureRevision: number) {
    const docId = currentDocId ?? mind.documentId
    if (!docId) return
    if (!mind.nodeData) return

    // 同一结构修订号只初始化一次，避免结构重建时重复请求
    if (initedStructureRevision === structureRevision) return
    initedStructureRevision = structureRevision

    const nodeIds: string[] = []
    collectAllNodeIds(mind.nodeData as unknown as NodeObj, nodeIds)

    console.log('[installMindMapEvidenceFeature] initCounts (structureReady)', {
      docId,
      structureRevision,
      nodeCount: nodeIds.length,
    })

    await evidenceStore.loadCounts(nodeIds)
    // 中文说明：向外发出“counts 已就绪”信号（用于切换/首次打开时的 readiness 门禁）
    mind.bus.fire('feature:evidenceCountsReady', {
      documentId: docId,
      structureRevision,
      nodeCount: nodeIds.length,
      timestamp: Date.now(),
    })
    // 中文说明：counts 变化会触发 addon 渲染/消失，需要做一次几何重算保证连线正确
    mind.requestReflow('addons:content')
  }

  const disposeLifecycle = installFeatureLifecycle(mind, {
    featureName: 'evidence:reference',
    awaitNextTickOnStructureReady: true,
    onDocumentReady: ({ documentId }, payload) => {
      const prevDocId = currentDocId
      currentDocId = documentId

      /**
       * 缓存重置策略（根因修复）
       *
       * 中文说明：
       * - switch：必须 reset，避免旧文档数据污染新文档
       * - reload（同一 documentId）：禁止 reset（否则会把 expandedByNodeId 清空，导致“引用展开被关回去”）
       *   但仍需要在 structureReady 后为“已展开节点”重拉列表，确保数据最新（挂证据工具写入卫星表）。
       */
      const isDocSwitch = payload.reason === 'switch' || (prevDocId !== null && prevDocId !== documentId)
      if (isDocSwitch) {
        evidenceStore.resetCache()
      } else {
        // reload：保留展开/缓存，后续在 structureReady 重拉已展开节点的列表
        shouldReloadExpandedListsOnNextStructureReady = true
      }
      initedStructureRevision = 0
      console.log('[installMindMapEvidenceFeature] documentReady', payload)
    },
    onStructureReady: async (_ctx, payload) => {
      await initCountsForStructureReady(payload.structureRevision)

      // reload 场景：为当前已展开的节点重拉一次列表，避免显示旧数据
      if (shouldReloadExpandedListsOnNextStructureReady) {
        shouldReloadExpandedListsOnNextStructureReady = false

        const expandedNodeIds = Object.entries(evidenceStore.expandedByNodeId)
          .filter(([, v]) => v === true)
          .map(([nodeId]) => nodeId)

        if (expandedNodeIds.length > 0) {
          console.log('[installMindMapEvidenceFeature] reload: refresh expanded evidence lists', {
            documentId: currentDocId ?? mind.documentId,
            expandedNodeIdsCount: expandedNodeIds.length,
            sample: expandedNodeIds.slice(0, 5),
          })
        }

        for (const nodeId of expandedNodeIds) {
          // 逐个加载：避免并发过高导致 IPC 拥塞；如未来有性能诉求再做受控并发
          await evidenceStore.loadEvidences(nodeId)
        }
        // 列表变化会影响节点高度，需重算连线
        mind.requestReflow('addons:content')
      }
    },
  })

  // 节点内引用区“展开/收起”：由 feature 统一响应（避免组件级监听耦合）
  const handleToggle = async (payload: { nodeId: string }) => {
    const nodeId = payload.nodeId
    if (!nodeId) return
    const docId = currentDocId ?? mind.documentId
    console.log('[installMindMapEvidenceFeature] toggleEvidenceInNode', {
      docId,
      nodeId,
      countSnapshot: evidenceStore.evidenceCounts[nodeId] ?? 0,
      expandedBefore: evidenceStore.expandedByNodeId[nodeId] === true,
    })
    const nextExpanded = evidenceStore.expandedByNodeId[nodeId] !== true
    evidenceStore.setNodeExpanded(nodeId, nextExpanded)
    if (nextExpanded) {
      try {
        await evidenceStore.loadEvidences(nodeId)
      } finally {
        mind.requestReflow('addons:toggle')
      }
    } else {
      mind.requestReflow('addons:toggle')
    }
  }
  // 中文说明：监听新事件名（ui:*），旧事件名仍会通过 bus 桥接双发
  mind.bus.addListener('ui:toggleReferenceInNode', handleToggle)

  const registry = getNodeAddonsRegistry(mind)
  const disposeAddon = registry.register({
    id: 'evidence:reference',
    order: 100,
    component: ReferenceAddon,
    track: () => {
      // 中文说明：显式声明依赖，保证 counts/expanded 变化时 Host 能稳定重算 renderItems
      // （避免“count 已加载但引用 UI 不出现”的不确定性）
      void evidenceStore.evidenceCounts
      void evidenceStore.expandedByNodeId
    },
    shouldRender: ({ nodeId }) => {
      const count = evidenceStore.evidenceCounts[nodeId] ?? 0
      const expanded = evidenceStore.expandedByNodeId[nodeId] === true
      return count > 0 || expanded
    },
  })

  return () => {
    mind.bus.removeListener('ui:toggleReferenceInNode', handleToggle)
    disposeLifecycle()
    disposeAddon()
    disposeSync()
  }
}

