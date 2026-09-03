/**
 * 证据同步插件 - 负责在节点操作时保持证据数据一致性
 *
 * 设计原则：
 * 1. 高内聚：所有证据同步逻辑集中在此插件
 * 2. 低耦合：通过 before hooks + operation bus 挂载，不侵入核心代码
 * 3. 健壮性：异常时阻止操作，避免数据不一致
 *
 * 处理的操作：
 * - 删除节点 (removeNodes): 软删除证据，支持 undo
 * - 复制节点 (copyNode/copyNodes): 克隆证据到新节点
 * - 剪切节点 (Ctrl+X): 迁移证据到新节点（不是删除+克隆）
 * - 撤销/重做: 恢复/重新软删除证据
 */

import type { MindMapInstance, NodeObj } from '../../../../domain/types/index'
import type { Topic } from '../../../../domain/types/dom'
import type { Operation } from '../../../../shared/utils/events/eventBus'
import { useMindMapStore } from '../../../../domain/store/mindmapStore'
import { useMindMapEvidenceStore } from '../store/evidenceStore'
import { unionTopics } from '../../../../shared/utils/dom'

// ============================================================================
// 类型定义
// ============================================================================

/** 复制操作的源节点记录 */
interface CopySourceRecord {
  type: 'single' | 'batch'
  sourceIds: string[]
  /** 是否是剪切操作（需要迁移而非克隆） */
  isCut: boolean
}

/** 插件内部状态 */
interface PluginState {
  /** 复制/剪切源节点队列，用于在 operation 事件中匹配新节点 */
  copySourceQueue: CopySourceRecord[]
  /** 记录哪些节点 ID 是通过剪切删除的（用于粘贴时判断走 move 还是 clone） */
  cutNodeIds: Set<string>
  /** 上一次删除操作涉及的节点 ID（用于 undo 时恢复证据） */
  lastDeletedNodeIds: string[]
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 递归收集节点及其所有子孙节点的 ID
 * @param nodeObj 节点对象
 * @returns 所有节点 ID 数组（包括自身）
 */
function collectAllDescendantIds(nodeObj: NodeObj): string[] {
  const ids: string[] = [nodeObj.id]
  if (nodeObj.children) {
    for (const child of nodeObj.children) {
      ids.push(...collectAllDescendantIds(child))
    }
  }
  return ids
}

/**
 * 从 Topic 数组中提取"顶层"节点（过滤掉其祖先也在列表中的节点）
 * 这是为了避免重复处理同一棵子树
 */
function filterToTopLevelNodes(topics: Topic[]): Topic[] {
  const idsToProcess = new Set(topics.map(t => t.nodeObj.id))
  return topics.filter(t => {
    let current = t.nodeObj.parent
    while (current) {
      if (idsToProcess.has(current.id)) {
        return false // 祖先也在列表中，跳过
      }
      current = current.parent
    }
    return true
  })
}

/**
 * 检查待删除节点是否是剪切操作的一部分
 * 剪切操作的特征：mind.waitCopy 包含待删除的节点
 */
function isCutOperation(mind: MindMapInstance, topics: Topic[]): boolean {
  if (!mind.waitCopy || mind.waitCopy.length === 0) {
    return false
  }
  const waitCopyIds = new Set(mind.waitCopy.map(t => t.nodeObj.id))
  // 如果待删除节点中有任何一个在 waitCopy 中，就是剪切操作
  return topics.some(t => waitCopyIds.has(t.nodeObj.id))
}

// ============================================================================
// 主插件函数
// ============================================================================

/**
 * 安装 MindMap 证据同步插件
 *
 * @param mind MindMap 实例
 * @returns 卸载函数，在 mind.destroy() 时调用
 */
export function installMindMapEvidenceSync(mind: MindMapInstance): () => void {
  // 插件内部状态
  const state: PluginState = {
    copySourceQueue: [],
    cutNodeIds: new Set(),
    lastDeletedNodeIds: [],
  }

  // 保存原有的 before hooks（如果有的话）
  const originalBeforeRemoveNodes = mind.before?.removeNodes
  const originalBeforeCopyNode = mind.before?.copyNode
  const originalBeforeCopyNodes = mind.before?.copyNodes

  // --------------------------------------------------------------------------
  // Before Hook: removeNodes
  // 处理删除节点时的证据软删除
  // --------------------------------------------------------------------------
  const beforeRemoveNodes = async (topics: Topic[]): Promise<boolean> => {
    // 先调用原有的 hook（如果存在）
    if (originalBeforeRemoveNodes) {
      const shouldContinue = await originalBeforeRemoveNodes.call(mind, topics)
      if (!shouldContinue) return false
    }

    const mindMapStore = useMindMapStore()
    const evidenceStore = useMindMapEvidenceStore()
    const documentId = mindMapStore.currentDocumentId

    if (!documentId) {
      console.warn('[EvidenceSyncPlugin] 无法获取当前文档 ID，跳过证据同步')
      return true // 允许继续删除，但不同步证据
    }

    /**
     * 关键：对齐 `domain/operations/nodeOperations.ts` 的 removeNodes 行为
     *
     * 根因说明（本次 Bug 的关键线索）：
     * - 框选时 selection 可能把 Root(mm-root>mm-topic) 一并选中塞进 currentNodes
     * - 实际删除逻辑 `removeNodes()` 会在 unionTopics 内过滤掉 root（nodeObj.parent 为空的节点不会被删）
     * - 但如果 evidence 同步插件不做同样过滤，就会对 root 做“递归收集子孙” → softDelete 全量引用
     * - 表现就是：删除某些无关节点时，所有引用突然都没了（尤其是框选删除）
     */
    const normalized = unionTopics(topics)
    if (normalized.length === 0) {
      return true
    }

    // 使用 nodeObj 关系进行过滤，只保留顶层节点（避免父子重复处理同一棵子树）
    const idsToProcess = new Set(normalized.map(t => t.nodeObj.id))
    const topLevelTopics = normalized.filter(t => {
      let current = t.nodeObj.parent
      while (current) {
        if (idsToProcess.has(current.id)) {
          return false
        }
        current = current.parent
      }
      return true
    })

    // 收集所有待删除节点的 ID（包括子孙）
    const allNodeIds: string[] = []
    for (const topic of topLevelTopics) {
      allNodeIds.push(...collectAllDescendantIds(topic.nodeObj))
    }

    // 检查是否是剪切操作
    const isCut = isCutOperation(mind, normalized)

    // 观测日志：如果 selection 里混入了 root，这里会被 normalized 过滤掉
    if (topics.length !== normalized.length) {
      const hasRootSelected = topics.some(t => !t.nodeObj.parent)
      if (hasRootSelected) {
        console.warn('[EvidenceSyncPlugin] removeNodes topics contained root, normalized by unionTopics', {
          topicsCount: topics.length,
          normalizedCount: normalized.length,
          topLevelCount: topLevelTopics.length,
        })
      }
    }

    if (isCut) {
      // 剪切操作：记录源节点 ID，不删除证据（证据会在粘贴时迁移）
      console.log('[EvidenceSyncPlugin] 检测到剪切操作，记录源节点 ID:', allNodeIds)
      for (const id of allNodeIds) {
        state.cutNodeIds.add(id)
      }
      // 同时记录到复制队列，粘贴时需要知道源节点
      state.copySourceQueue.push({
        type: topLevelTopics.length === 1 ? 'single' : 'batch',
        sourceIds: topLevelTopics.map(t => t.nodeObj.id),
        isCut: true,
      })
    } else {
      // 普通删除：软删除证据
      console.log('[EvidenceSyncPlugin] 执行证据软删除，节点 ID:', allNodeIds)
      try {
        await evidenceStore.softDelete(allNodeIds)
        // 记录删除的节点 ID，用于 undo 恢复（V1 简化：只记录最近一次）
        state.lastDeletedNodeIds = allNodeIds
      } catch (error) {
        console.error('[EvidenceSyncPlugin] 软删除证据失败:', error)
      }
    }

    return true
  }

  // --------------------------------------------------------------------------
  // Before Hook: copyNode
  // 记录单节点复制的源节点 ID
  // --------------------------------------------------------------------------
  const beforeCopyNode = async (node: Topic, to: Topic): Promise<boolean> => {
    if (originalBeforeCopyNode) {
      const shouldContinue = await originalBeforeCopyNode.call(mind, node, to)
      if (!shouldContinue) return false
    }

    // 检查这个源节点是否是剪切的（在 cutNodeIds 中）
    const isCut = state.cutNodeIds.has(node.nodeObj.id)

    state.copySourceQueue.push({
      type: 'single',
      sourceIds: [node.nodeObj.id],
      isCut,
    })

    console.log('[EvidenceSyncPlugin] 记录复制源节点:', node.nodeObj.id, '剪切:', isCut)
    return true
  }

  // --------------------------------------------------------------------------
  // Before Hook: copyNodes
  // 记录批量复制的源节点 ID
  // --------------------------------------------------------------------------
  const beforeCopyNodes = async (nodes: Topic[], to: Topic): Promise<boolean> => {
    if (originalBeforeCopyNodes) {
      const shouldContinue = await originalBeforeCopyNodes.call(mind, nodes, to)
      if (!shouldContinue) return false
    }

    const sourceIds = nodes.map(n => n.nodeObj.id)
    // 检查是否有任何源节点是剪切的
    const isCut = sourceIds.some(id => state.cutNodeIds.has(id))

    state.copySourceQueue.push({
      type: 'batch',
      sourceIds,
      isCut,
    })

    console.log('[EvidenceSyncPlugin] 记录批量复制源节点:', sourceIds, '剪切:', isCut)
    return true
  }

  // --------------------------------------------------------------------------
  // Operation Bus Handler
  // 处理 copyNode/copyNodes 事件，完成证据克隆/迁移
  // --------------------------------------------------------------------------
  const handleOperation = async (operation: Operation) => {
    const evidenceStore = useMindMapEvidenceStore()

    if (operation.name === 'copyNode') {
      const record = state.copySourceQueue.shift()
      if (!record || record.type !== 'single') {
        console.warn('[EvidenceSyncPlugin] copyNode 事件但队列中无对应记录')
        return
      }

      const sourceId = record.sourceIds[0]
      const targetId = (operation as { name: 'copyNode'; obj: NodeObj }).obj.id

      if (record.isCut) {
        console.log('[EvidenceSyncPlugin] 迁移证据:', sourceId, '->', targetId)
        await evidenceStore.moveEvidence(sourceId, targetId)
        state.cutNodeIds.delete(sourceId)
      } else {
        console.log('[EvidenceSyncPlugin] 克隆证据:', sourceId, '->', targetId)
        await evidenceStore.cloneEvidence(sourceId, targetId)
      }
    } else if (operation.name === 'copyNodes') {
      const record = state.copySourceQueue.shift()
      if (!record || record.type !== 'batch') {
        console.warn('[EvidenceSyncPlugin] copyNodes 事件但队列中无对应记录')
        return
      }

      const targetObjs = (operation as { name: 'copyNodes'; objs: NodeObj[] }).objs
      const pairCount = Math.min(record.sourceIds.length, targetObjs.length)

      for (let i = 0; i < pairCount; i++) {
        const sourceId = record.sourceIds[i]
        const targetId = targetObjs[i].id

        if (record.isCut) {
          console.log('[EvidenceSyncPlugin] 迁移证据:', sourceId, '->', targetId)
          await evidenceStore.moveEvidence(sourceId, targetId)
          state.cutNodeIds.delete(sourceId)
        } else {
          console.log('[EvidenceSyncPlugin] 克隆证据:', sourceId, '->', targetId)
          await evidenceStore.cloneEvidence(sourceId, targetId)
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // Undo/Redo 支持（V1 简化）
  // 中文说明（Phase 2 变更）：
  // - keydown 监听已迁移到 KeymapRegistry
  // - 通过 createEvidenceKeymap() 创建 KeymapItem，由外部注册
  // - 这里只保留恢复逻辑的实现
  // --------------------------------------------------------------------------

  /**
   * 恢复软删除的证据
   *
   * 中文说明：
   * - 由 KeymapRegistry 的 evidence.undo 快捷键调用
   * - 返回 true 表示有证据需要恢复，false 表示无需处理
   */
  const restoreDeletedEvidence = async (): Promise<boolean> => {
    if (state.lastDeletedNodeIds.length === 0) {
      return false
    }

    console.log('[EvidenceSyncPlugin] Undo 检测，恢复证据:', state.lastDeletedNodeIds)
    const evidenceStore = useMindMapEvidenceStore()
    try {
      await evidenceStore.restoreSoftDeleted(state.lastDeletedNodeIds)
      return true
    } catch (error) {
      console.error('[EvidenceSyncPlugin] 恢复证据失败:', error)
      return false
    } finally {
      // V1：只支持最近一次删除的恢复（后续可接入完整 history）
      state.lastDeletedNodeIds = []
    }
  }

  // 将恢复函数挂载到 mind 实例，供 KeymapRegistry 调用
  // 中文说明：这是一个临时方案，后续可以改为更优雅的依赖注入
  ;(mind as MindMapInstance & { _evidenceRestoreUndo?: () => Promise<boolean> })._evidenceRestoreUndo = restoreDeletedEvidence

  // --------------------------------------------------------------------------
  // 注册 Hooks 和事件监听
  // --------------------------------------------------------------------------

  // 确保 before 对象存在
  if (!mind.before) {
    ;(mind as { before?: Record<string, unknown> }).before = {}
  }

  mind.before.removeNodes = beforeRemoveNodes
  mind.before.copyNode = beforeCopyNode
  mind.before.copyNodes = beforeCopyNodes

  mind.bus.addListener('operation', handleOperation)

  /**
   * 中文说明（Phase 2 变更）：
   * - keydown 监听已迁移到 KeymapRegistry
   * - 通过 _evidenceRestoreUndo 方法暴露恢复逻辑
   * - 在 defaultKeymap.ts 中通过 evidence.undo 快捷键调用
   */

  console.log('[EvidenceSyncPlugin] 已安装')

  // --------------------------------------------------------------------------
  // 返回卸载函数
  // --------------------------------------------------------------------------
  return () => {
    if (originalBeforeRemoveNodes) {
      mind.before.removeNodes = originalBeforeRemoveNodes
    } else {
      delete mind.before.removeNodes
    }
    if (originalBeforeCopyNode) {
      mind.before.copyNode = originalBeforeCopyNode
    } else {
      delete mind.before.copyNode
    }
    if (originalBeforeCopyNodes) {
      mind.before.copyNodes = originalBeforeCopyNodes
    } else {
      delete mind.before.copyNodes
    }

    mind.bus.removeListener('operation', handleOperation)

    // 清理挂载的恢复函数
    delete (mind as MindMapInstance & { _evidenceRestoreUndo?: () => Promise<boolean> })._evidenceRestoreUndo

    state.copySourceQueue.length = 0
    state.cutNodeIds.clear()
    state.lastDeletedNodeIds = []

    console.log('[EvidenceSyncPlugin] 已卸载')
  }
}

