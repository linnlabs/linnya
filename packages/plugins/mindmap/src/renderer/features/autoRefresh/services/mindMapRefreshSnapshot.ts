/**
 * @file 快照与恢复 - 刷新前后保持 viewport/selection 稳定
 *
 * 中文说明：
 * - 刷新前保存当前 viewport 和 selection
 * - 刷新后尝试恢复到原状态
 * - 若节点不存在则清空选区（不猜测替代节点）
 *
 * @see packages/plugins/mindmap/src/renderer/features/autoRefresh/README.md
 */

import type { MindMapInstance, NodeObj } from '../../../domain/types'
import type { Topic } from '../../../domain/types/dom'
import { useMindMapStore } from '../../../domain/store/mindmapStore'
import type {
  RefreshSnapshot,
  ViewportSnapshot,
  SelectionSnapshot,
  FocusModeSnapshot,
} from '../domain/types'
import { LOG_PREFIX } from '../domain/types'

// =========================================================================
// 快照采集
// =========================================================================

/**
 * 采集 viewport 快照
 *
 * 中文说明：
 * - **必须**复用 `mindmapStore.getViewportSnapshot()` 作为权威口径
 * - 原因（根因级）：
 *   - AutoRefresh 的触发点在“工具结果返回”的时刻，此时 MindMap 可能正处于 open/reload 的瞬态阶段；
 *   - 旧实现直接从 `mind.map.style.transform` 解析，在 map/transform 暂不可用时会退化为 (0,0,1)，
 *     这会导致刷新后 restore 把视图硬拉回默认位置，表现为“视图往上跑/图往下跑”；
 *   - store 的实现会在实例不可用时回退到内存缓存/metadata，并使用统一的 transform 解析函数，
 *     能保证快照稳定、与“锚点视口”缓存体系一致。
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function takeViewportSnapshot(): ViewportSnapshot {
  const store = useMindMapStore()
  return store.getViewportSnapshot()
}

/**
 * 采集 selection 快照
 *
 * 中文说明：
 * - 从 mindmapStore.currentNodes 获取当前选中节点
 * - 提取每个节点的 ID 用于刷新后恢复
 */
function takeSelectionSnapshot(): SelectionSnapshot {
  const store = useMindMapStore()
  const currentNodes = store.currentNodes

  if (!currentNodes || currentNodes.length === 0) {
    return { nodeIds: [], currentNodeId: null }
  }

  // 中文说明：从 Topic 元素提取 nodeId（存储在 dataset 或通过 nodeObj 关联）
  const nodeIds: string[] = []
  for (const node of currentNodes) {
    // Topic 元素的 nodeId 可通过 data-nodeid 或 nodeObj.id 获取
    const nodeId = node.nodeObj?.id
    if (nodeId) {
      nodeIds.push(nodeId)
    }
  }

  const currentNodeId = store.currentNode?.nodeObj?.id ?? null

  return { nodeIds, currentNodeId }
}

/**
 * 采集 FocusMode（专注模式）快照
 *
 * 中文说明：
 * - MindMap 支持通过 `focusNode()` 聚焦某个节点子树（右键菜单可触发）
 * - 全量 reload 会重建实例，若不记录该状态会导致用户从“专注视图”被踢回全图
 */
function takeFocusModeSnapshot(): FocusModeSnapshot {
  const store = useMindMapStore()
  const mind = store.mind

  if (!mind) {
    return {
      isFocusMode: false,
      focusedNodeId: null,
      direction: 1,
      tempDirection: null,
    }
  }

  const isFocusMode = mind.isFocusMode === true
  const focusedNodeId = isFocusMode ? mind.nodeData?.id ?? null : null

  return {
    isFocusMode,
    focusedNodeId,
    direction: mind.direction,
    tempDirection: mind.tempDirection ?? null,
  }
}

/**
 * 采集完整快照
 *
 * @returns 完整的刷新快照
 */
export function takeRefreshSnapshot(): RefreshSnapshot {
  return {
    viewport: takeViewportSnapshot(),
    selection: takeSelectionSnapshot(),
    focusMode: takeFocusModeSnapshot(),
    takenAt: Date.now(),
  }
}

// =========================================================================
// 快照恢复
// =========================================================================

/**
 * 恢复结果
 */
export interface RestoreResult {
  /** viewport 是否恢复成功 */
  viewportRestored: boolean
  /** selection 是否恢复成功 */
  selectionRestored: boolean
  /** focusMode 是否恢复成功 */
  focusModeRestored: boolean
  /** 恢复失败原因 */
  failReason?: string
}

/**
 * 恢复 viewport
 *
 * 中文说明：
 * - 将画布移动到快照记录的位置和缩放
 * - 避免刷新后跳回中心
 */
// 避免未使用的函数报错
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function restoreViewport(
  mind: MindMapInstance,
  viewport: ViewportSnapshot
): boolean {
  try {
    const { x, y, scale } = viewport

    // 设置 transform
    if (mind.map) {
      mind.map.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
      mind.scaleVal = scale
    }

    return true
  } catch (error) {
    console.warn(`${LOG_PREFIX} restoreViewport failed:`, error)
    return false
  }
}

/**
 * 在 nodeData 中查找节点是否存在
 */
function nodeExistsInTree(nodeData: NodeObj | null, nodeId: string): boolean {
  if (!nodeData) return false

  const traverse = (node: NodeObj): boolean => {
    if (node.id === nodeId) return true
    if (node.children) {
      for (const child of node.children) {
        if (traverse(child)) return true
      }
    }
    return false
  }

  return traverse(nodeData)
}

/**
 * 在 nodeData 中查找指定节点
 *
 * 中文说明：
 * - 只沿 children 向下遍历，避免 parent 指针导致循环
 * - 返回 NodeObj 引用（用于 focus 模式切换）
 */
function findNodeInTree(nodeData: NodeObj | null, nodeId: string): NodeObj | null {
  if (!nodeData) return null

  const traverse = (node: NodeObj): NodeObj | null => {
    if (node.id === nodeId) return node
    const children = node.children
    if (Array.isArray(children)) {
      for (const child of children) {
        const found = traverse(child)
        if (found) return found
      }
    }
    return null
  }

  return traverse(nodeData)
}

/**
 * 恢复 FocusMode（专注模式）
 *
 * 中文说明：
 * - 不依赖 DOM Topic（避免节点折叠导致 findEle 失败）
 * - 直接切换 nodeData 到被聚焦节点，并触发一次结构重建 refresh()
 */
function restoreFocusMode(
  mind: MindMapInstance,
  focusMode: FocusModeSnapshot
): { restored: boolean; failReason?: string } {
  if (!focusMode.isFocusMode) {
    // 快照显示不在专注模式：确保当前也不在
    if (mind.isFocusMode) {
      try {
        mind.cancelFocus()
      } catch (error) {
        return { restored: false, failReason: `cancelFocus failed: ${String(error)}` }
      }
    }
    return { restored: true }
  }

  if (!focusMode.focusedNodeId) {
    return { restored: false, failReason: 'focusedNodeId is null' }
  }

  const focusedNode = findNodeInTree(mind.nodeData, focusMode.focusedNodeId)
  if (!focusedNode) {
    return {
      restored: false,
      failReason: `focused node not found: ${focusMode.focusedNodeId}`,
    }
  }

  try {
    // 中文说明：先清空选区，避免选中状态引用旧 DOM
    mind.clearSelection()

    // 进入专注模式：备份全量 nodeData，然后切换为 focusedNode
    if (!mind.isFocusMode) {
      mind.nodeDataBackup = mind.nodeData
      mind.isFocusMode = true
    }

    // tempDirection：以快照为准，保证 cancelFocus 后可还原布局
    mind.tempDirection = focusMode.tempDirection ?? mind.tempDirection ?? null

    // 恢复专注模式下的布局方向（专注模式期间允许用户切换布局）
    mind.direction = focusMode.direction

    // 切换为专注子树并触发结构重建
    mind.nodeData = focusedNode
    mind.refresh()

    return { restored: true }
  } catch (error) {
    console.warn(`${LOG_PREFIX} restoreFocusMode failed:`, error)
    return { restored: false, failReason: String(error) }
  }
}

/**
 * 恢复 selection
 *
 * 中文说明：
 * - 检查快照中的节点 ID 是否仍存在于新 nodeData
 * - 存在则恢复选区，不存在则清空
 * - 禁止猜测替代节点
 */
function restoreSelection(
  mind: MindMapInstance,
  selection: SelectionSnapshot
): { restored: boolean; failReason?: string } {
  const { nodeIds, currentNodeId } = selection

  // 若快照为空，无需恢复
  if (nodeIds.length === 0) {
    return { restored: true }
  }

  const nodeData = mind.nodeData
  if (!nodeData) {
    return { restored: false, failReason: 'nodeData is null' }
  }

  // 检查哪些节点仍存在
  const existingNodeIds = nodeIds.filter((id) => nodeExistsInTree(nodeData, id))

  if (existingNodeIds.length === 0) {
    // 所有节点都不存在，清空选区
    mind.clearSelection()
    return {
      restored: false,
      failReason: `all ${nodeIds.length} nodes no longer exist`,
    }
  }

  if (existingNodeIds.length < nodeIds.length) {
    console.log(
      `${LOG_PREFIX} restoreSelection: ${nodeIds.length - existingNodeIds.length} nodes no longer exist, restoring ${existingNodeIds.length}`
    )
  }

  // 尝试恢复选区
  try {
    // 找到对应的 DOM 元素（Topic）
    const topicsToSelect: Topic[] = []

    // 中文说明：currentNodeId 尽量放到最后，保证恢复后 currentNode 稳定
    const orderedNodeIds = (() => {
      if (!currentNodeId) return existingNodeIds
      if (!existingNodeIds.includes(currentNodeId)) return existingNodeIds
      return [
        ...existingNodeIds.filter((id) => id !== currentNodeId),
        currentNodeId,
      ]
    })()

    for (const nodeId of orderedNodeIds) {
      // 中文说明：
      // - 统一使用 mind.findEle(nodeId) 获取 Topic
      // - findEle 在节点折叠/DOM 未就绪时会 throw；这里捕获并跳过
      try {
        const topicEl = mind.findEle(nodeId)
        topicsToSelect.push(topicEl)
      } catch {
        // 跳过：该节点可能处于折叠/不可见状态或 DOM 尚未完成挂载
      }
    }

    if (topicsToSelect.length === 0) {
      // DOM 元素未找到（可能还在渲染中）
      mind.clearSelection()
      return { restored: false, failReason: 'DOM topics not found (collapsed or not mounted yet)' }
    }

    // 恢复选区
    // 中文说明：先清空再批量选中，确保干净的选区状态且不触发重复 clear
    mind.clearSelection()
    mind.selectNodes(topicsToSelect)

    return { restored: true }
  } catch (error) {
    console.warn(`${LOG_PREFIX} restoreSelection failed:`, error)
    return { restored: false, failReason: String(error) }
  }
}

/**
 * 恢复完整快照
 *
 * 中文说明：
 * - 先恢复 viewport，再恢复 selection
 * - 即使部分失败也继续执行
 * - 返回详细的恢复结果
 *
 * @param mind MindMapInstance 实例
 * @param snapshot 之前采集的快照
 * @param options 配置选项
 */
export function restoreRefreshSnapshot(
  mind: MindMapInstance,
  snapshot: RefreshSnapshot,
  options: {
    /** 是否输出调试日志 */
    debug?: boolean
  } = {}
): RestoreResult {
  const { debug = false } = options

  // 0. 恢复 focusMode（先切换数据结构，再恢复 viewport/selection）
  const focusModeResult = restoreFocusMode(mind, snapshot.focusMode)

  if (debug) {
    if (focusModeResult.restored) {
      console.log(`${LOG_PREFIX} restoreSnapshot: focusMode restored`, snapshot.focusMode)
    } else {
      console.log(
        `${LOG_PREFIX} restoreSnapshot: focusMode restore failed -`,
        focusModeResult.failReason
      )
    }
  }

  // 1. 恢复 viewport
  // 中文说明（根因修复：视图漂移/图往下跑）：
  // - AutoRefresh 期间文档内容变化会导致布局（Root 宽高/基准点）改变；
  // - 此时“绝对坐标 (x,y)”已不再对应原来的视觉位置；
  // - mindmapStore 已经内置了“锚点视口（Anchor）”机制，会在 geometryFlushed 时自动重基准（抗漂移）；
  // - 这里如果再强制恢复旧的绝对 Viewport，反而会破坏 Store 的自适应结果，导致视图错位。
  // - 因此：AutoRefresh 不再干预 Viewport，全权交给 Store 处理。
  const viewportRestored = true // restoreViewport(mind, snapshot.viewport)

  if (debug && viewportRestored) {
    console.log(`${LOG_PREFIX} restoreSnapshot: viewport restore skipped (delegated to store anchor logic)`)
  }

  // 2. 恢复 selection
  const selectionResult = restoreSelection(mind, snapshot.selection)

  if (debug) {
    if (selectionResult.restored) {
      console.log(
        `${LOG_PREFIX} restoreSnapshot: selection restored`,
        snapshot.selection.nodeIds
      )
    } else {
      console.log(
        `${LOG_PREFIX} restoreSnapshot: selection restore failed -`,
        selectionResult.failReason
      )
    }
  }

  return {
    viewportRestored,
    selectionRestored: selectionResult.restored,
    focusModeRestored: focusModeResult.restored,
    failReason: focusModeResult.failReason ?? selectionResult.failReason,
  }
}
