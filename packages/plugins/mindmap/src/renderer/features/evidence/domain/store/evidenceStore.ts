import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  mindMapEvidenceGateway,
  type CreateEvidenceParams,
  type MindMapEvidence,
  type UpdateEvidenceParams,
} from '../../../../ipc/mindMapEvidenceGateway'
import { useMindMapStore } from '../../../../domain/store/mindmapStore'

type CacheStatus = 'unknown' | 'loading' | 'loaded' | 'error'
type EvidenceListStatus = 'unknown' | 'loading' | 'loaded' | 'empty' | 'error'

type CountCacheEntry = {
  status: CacheStatus
  updatedAt?: number
  error?: unknown
}

type EvidenceListCacheEntry = {
  status: EvidenceListStatus
  /**
   * 请求序号：用于处理并发/竞态（只应用“最新一次请求”的结果）
   */
  requestId: number
  updatedAt?: number
  error?: unknown
}

/**
 * MindMap Evidence Store
 *
 * 中文说明：
 * - 这是 Evidence Feature 的状态容器（对齐 editor 的 feature 组织方式）。
 * - Store 名称保持不变（`mindmap-evidence`），避免迁移后 Pinia 的 devtools 观察/持久化出现断裂。
 */
export const useMindMapEvidenceStore = defineStore('mindmap-evidence', () => {
  const mindMapStore = useMindMapStore()

  // Cache counts: nodeId -> count
  const evidenceCounts = ref<Record<string, number>>({})
  /**
   * count 缓存状态：nodeId -> status
   *
   * 中文说明（缓存契约）：
   * - unknown：从未加载（UI 不应把它当成 0）
   * - loading：正在加载中
   * - loaded：已加载（此时 evidenceCounts[nodeId] 必须有值，0 表示 known-empty）
   * - error：加载失败（UI 可展示降级态，但禁止“默认为 0”掩盖错误）
   */
  const countCacheByNodeId = ref<Record<string, CountCacheEntry>>({})
  /**
   * 节点引用区域的展开状态：nodeId -> expanded
   *
   * 中文说明（根因修复）：
   * - 之前展开状态由组件内部的 ref 维护，重启/切换后必然丢失
   * - 并且单实例 Teleport 只能同时展开一个节点（本质是架构限制）
   * - 把展开状态上移到 store 后，UI 可以按 nodeId 独立展开，且与“是否选中节点”解耦
   */
  const expandedByNodeId = ref<Record<string, boolean>>({})

  /**
   * 按节点缓存引用列表：nodeId -> evidences[]
   *
   * 根因说明（为什么必须这么做）：
   * - 之前只有 `currentEvidences/currentNodeId`，当 UI 同时存在：
   *   - 节点下“预览/展开”
   *   - 徽章 hover 的 QuickView
   *   - 插入引用面板 / 其它引用 UI
   *   这三者会相互覆盖同一份列表，导致预览闪烁/面板内容跳变。
   * - 改为按 nodeId 缓存后，各个视图可以并行读取同一 nodeId 的数据，
   *   且互不干扰，符合高内聚低耦合。
   */
  const evidencesByNodeId = ref<Record<string, MindMapEvidence[]>>({})
  const isLoading = ref(false)
  /**
   * list 缓存状态：nodeId -> status
   *
   * 中文说明（缓存契约）：
   * - unknown：未加载（与 empty 区分，避免把“未知”当成“空”）
   * - loading：正在加载
   * - loaded：已加载且非空
   * - empty：已加载但为空（known-empty）
   * - error：加载失败（保持可观测，不做补丁式兜底）
   */
  const listCacheByNodeId = ref<Record<string, EvidenceListCacheEntry>>({})

  // Actions

  function getCountStatus(nodeId: string): CacheStatus {
    return countCacheByNodeId.value[nodeId]?.status ?? 'unknown'
  }

  function isCountKnown(nodeId: string): boolean {
    return getCountStatus(nodeId) === 'loaded'
  }

  function getCount(nodeId: string): number | null {
    if (!isCountKnown(nodeId)) return null
    return evidenceCounts.value[nodeId] ?? 0
  }

  function getListStatus(nodeId: string): EvidenceListStatus {
    return listCacheByNodeId.value[nodeId]?.status ?? 'unknown'
  }

  function getList(nodeId: string): MindMapEvidence[] | null {
    const status = getListStatus(nodeId)
    // 中文说明（根因修复）：
    // - loadEvidences() 明确“不强制清空旧列表，避免 UI 闪烁”
    // - 但旧实现会在 status=loading 时返回 null，导致 UI 认为列表瞬间为空 -> 节点高度塌陷 -> “先变小再恢复”的闪烁
    // - 因此 loading 态应返回已缓存的旧数据（stale），让 UI 结构稳定；若确实无缓存，则返回 null
    if (status === 'unknown' || status === 'error') return null
    if (status === 'loading') {
      const cached = evidencesByNodeId.value[nodeId]
      return cached ? cached : null
    }
    return evidencesByNodeId.value[nodeId] ?? []
  }

  /**
   * 重置缓存（仅影响前端缓存，不影响数据库）
   *
   * 中文说明（根因修复）：
   * - MindMap 的文档切换/重载会导致 currentDocumentId 变化
   * - 如果不清理缓存，旧文档的数据可能污染新文档（或出现“看起来消失/不刷新”的错觉）
   */
  function resetCache() {
    evidenceCounts.value = {}
    countCacheByNodeId.value = {}
    evidencesByNodeId.value = {}
    expandedByNodeId.value = {}
    isLoading.value = false
    listCacheByNodeId.value = {}
  }

  /**
   * 初始化文档的引用计数 (全量或视口内，当前先做全量)
   * 可以在文档加载完毕后调用
   */
  async function loadCounts(nodeIds: string[]) {
    const docId = mindMapStore.currentDocumentId
    if (!docId || nodeIds.length === 0) {
      console.log('[MindMapEvidenceStore] skip loadCounts', {
        hasDocId: Boolean(docId),
        nodeIdCount: nodeIds.length,
      })
      return
    }

    // 标记为 loading（只标记本次请求范围，避免影响其它已加载节点）
    const nextCountCache: Record<string, CountCacheEntry> = { ...countCacheByNodeId.value }
    const now = Date.now()
    for (const nodeId of nodeIds) {
      nextCountCache[nodeId] = { status: 'loading', updatedAt: now }
    }
    countCacheByNodeId.value = nextCountCache

    const res = await mindMapEvidenceGateway.count(docId, nodeIds)
    if (res.success && res.data) {
      /**
       * 合并计数，并把“未返回的节点”补齐为 0
       *
       * 根因说明（非常关键）：
       * - 后端 count 接口可能只返回“有引用的节点”（count > 0）的条目
       * - 如果前端不把其余节点显式写成 0，那么 UI 会把它当成“未知”
       *   进而在右键菜单仍显示“展开引用”（而不是“添加引用”）。
       *
       * 这里把本次请求的 nodeIds 全量补齐，保证：
       * - `evidenceCounts[nodeId] === 0` 表示“已知无引用”
       * - `evidenceCounts` 中不存在该 key 才表示“未加载/未知”
       */
      const merged: Record<string, number> = { ...evidenceCounts.value, ...res.data }
      for (const nodeId of nodeIds) {
        if (!Object.prototype.hasOwnProperty.call(merged, nodeId)) {
          merged[nodeId] = 0
        }
      }
      evidenceCounts.value = merged

      // 标记为 loaded（并保证 evidenceCounts 里一定有值）
      const loadedCache: Record<string, CountCacheEntry> = { ...countCacheByNodeId.value }
      const loadedAt = Date.now()
      for (const nodeId of nodeIds) {
        loadedCache[nodeId] = { status: 'loaded', updatedAt: loadedAt }
      }
      countCacheByNodeId.value = loadedCache

      // 中文说明：输出一次摘要，便于定位“count 全为 0 / 节点不匹配 / docId 错误”等根因
      const nonZero = Object.entries(merged).filter(([, c]) => c > 0)
      console.log('[MindMapEvidenceStore] loadCounts done', {
        documentId: docId,
        requestNodeIds: nodeIds.length,
        returnedKeys: Object.keys(res.data).length,
        nonZeroKeys: nonZero.length,
        sampleNonZero: nonZero.slice(0, 5).map(([nodeId, count]) => ({ nodeId, count })),
      })
    } else {
      const errorCache: Record<string, CountCacheEntry> = { ...countCacheByNodeId.value }
      const errorAt = Date.now()
      for (const nodeId of nodeIds) {
        errorCache[nodeId] = { status: 'error', updatedAt: errorAt, error: 'error' in res ? res.error : res }
      }
      countCacheByNodeId.value = errorCache

      console.warn('[MindMapEvidenceStore] loadCounts failed', {
        documentId: docId,
        requestNodeIds: nodeIds.length,
        error: 'error' in res ? (res.error as unknown) : undefined,
      })
    }
  }

  /**
   * 加载特定节点的引用列表 (展开看板时调用)
   */
  async function loadEvidences(nodeId: string) {
    const docId = mindMapStore.currentDocumentId
    if (!docId) return

    const prev = listCacheByNodeId.value[nodeId]
    const requestId = (prev?.requestId ?? 0) + 1
    listCacheByNodeId.value = {
      ...listCacheByNodeId.value,
      [nodeId]: { status: 'loading', requestId, updatedAt: Date.now() },
    }

    isLoading.value = true
    // 中文说明：不在这里强制清空旧列表，避免 UI 闪烁；加载成功后会整体替换。

    try {
      const prevCount = evidenceCounts.value[nodeId] ?? 0
      const res = await mindMapEvidenceGateway.list(docId, nodeId)
      // 竞态保护：只应用“最新一次请求”的结果
      const latest = listCacheByNodeId.value[nodeId]
      if (!latest || latest.requestId !== requestId) {
        return
      }
      if (res.success && res.data) {
        evidencesByNodeId.value[nodeId] = res.data
        // 顺便更新一下 count
        evidenceCounts.value[nodeId] = res.data.length
        countCacheByNodeId.value = {
          ...countCacheByNodeId.value,
          [nodeId]: { status: 'loaded', updatedAt: Date.now() },
        }

        listCacheByNodeId.value = {
          ...listCacheByNodeId.value,
          [nodeId]: {
            status: res.data.length === 0 ? 'empty' : 'loaded',
            requestId,
            updatedAt: Date.now(),
          },
        }

        /**
         * 一致性自检（用于定位“插入后神秘消失”根因）
         *
         * 中文说明：
         * - 如果之前 count>0，但 list 返回空数组，这通常意味着：
         *   1) docId/nodeId 不一致（写入与读取的 key 不同）
         *   2) 引用被误软删除（deleted_at 被置位）
         *   3) list IPC 发生异常但被包装成 success=true（后端实现问题）
         * - 这里不做“补丁式修复”，而是做一次 count 复核并输出关键日志，帮助定位根因。
         */
        if (prevCount > 0 && res.data.length === 0) {
          console.warn('[MindMapEvidenceStore] list returned empty but previous count > 0', {
            documentId: docId,
            nodeId,
            prevCount,
          })

          const countRes = await mindMapEvidenceGateway.count(docId, [nodeId])
          if (countRes.success && countRes.data) {
            const confirmedCount = countRes.data[nodeId] ?? 0
            console.warn('[MindMapEvidenceStore] count recheck result', {
              documentId: docId,
              nodeId,
              confirmedCount,
            })
            evidenceCounts.value[nodeId] = confirmedCount
            countCacheByNodeId.value = {
              ...countCacheByNodeId.value,
              [nodeId]: { status: 'loaded', updatedAt: Date.now() },
            }
          } else {
            console.warn('[MindMapEvidenceStore] count recheck failed', {
              documentId: docId,
              nodeId,
              error: 'error' in countRes ? (countRes.error as unknown) : undefined,
            })
          }
        }
      } else {
        listCacheByNodeId.value = {
          ...listCacheByNodeId.value,
          [nodeId]: { status: 'error', requestId, updatedAt: Date.now(), error: 'error' in res ? res.error : res },
        }
      }
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 添加引用
   */
  async function addEvidence(params: Omit<CreateEvidenceParams, 'documentId'>) {
    const docId = mindMapStore.currentDocumentId
    if (!docId) {
      console.error('[MindMapEvidenceStore] addEvidence failed: missing currentDocumentId', {
        mindmapNodeId: params.mindmapNodeId,
        sourceType: params.sourceType,
      })
      return null
    }

    const res = await mindMapEvidenceGateway.add({ ...params, documentId: docId })
    if (res.success && res.data) {
      const newItem = res.data

      // 更新本地缓存：保证“新增后节点下预览”能立即显示
      const list = evidencesByNodeId.value[params.mindmapNodeId]
      if (Array.isArray(list)) {
        evidencesByNodeId.value[params.mindmapNodeId] = [...list, newItem]
      } else {
        evidencesByNodeId.value[params.mindmapNodeId] = [newItem]
      }

      // 更新计数
      const currentCount = evidenceCounts.value[params.mindmapNodeId] || 0
      evidenceCounts.value[params.mindmapNodeId] = currentCount + 1
      countCacheByNodeId.value = {
        ...countCacheByNodeId.value,
        [params.mindmapNodeId]: { status: 'loaded', updatedAt: Date.now() },
      }

      // 更新 list 缓存状态：新增后至少是 loaded（不会是 unknown）
      const prev = listCacheByNodeId.value[params.mindmapNodeId]
      listCacheByNodeId.value = {
        ...listCacheByNodeId.value,
        [params.mindmapNodeId]: {
          status: 'loaded',
          requestId: prev?.requestId ?? 0,
          updatedAt: Date.now(),
        },
      }

      return newItem
    }
    return null
  }

  /**
   * 更新引用
   */
  async function updateEvidence(params: UpdateEvidenceParams) {
    const res = await mindMapEvidenceGateway.update(params)
    if (res.success) {
      // 更新本地缓存（按 nodeId 扫描命中项）
      const updated: Record<string, MindMapEvidence[]> = { ...evidencesByNodeId.value }
      let changed = false
      for (const [nodeId, list] of Object.entries(updated)) {
        const index = list.findIndex(e => e.id === params.id)
        if (index === -1) continue
        const next = [...list]
        next[index] = { ...next[index], ...params }
        updated[nodeId] = next
        changed = true
      }
      if (changed) {
        evidencesByNodeId.value = updated
      }
    }
  }

  /**
   * 删除引用
   */
  async function removeEvidence(id: string, nodeId: string) {
    const res = await mindMapEvidenceGateway.remove(id)
    if (res.success) {
      // 更新列表
      const list = evidencesByNodeId.value[nodeId]
      if (Array.isArray(list)) {
        evidencesByNodeId.value[nodeId] = list.filter(e => e.id !== id)
      }

      // 更新计数
      const currentCount = evidenceCounts.value[nodeId] || 0
      if (currentCount > 0) {
        evidenceCounts.value[nodeId] = currentCount - 1
      }

      countCacheByNodeId.value = {
        ...countCacheByNodeId.value,
        [nodeId]: { status: 'loaded', updatedAt: Date.now() },
      }

      const nextList = evidencesByNodeId.value[nodeId]
      const nextStatus: EvidenceListStatus =
        Array.isArray(nextList) && nextList.length === 0 ? 'empty' : 'loaded'
      const prev = listCacheByNodeId.value[nodeId]
      listCacheByNodeId.value = {
        ...listCacheByNodeId.value,
        [nodeId]: { status: nextStatus, requestId: prev?.requestId ?? 0, updatedAt: Date.now() },
      }
    }
  }

  /**
   * 批量清理 (节点删除时调用)
   * UI 不需要等待这个结果，fire and forget 即可
   */
  async function batchRemove(nodeIds: string[]) {
    const docId = mindMapStore.currentDocumentId
    if (!docId) return

    await mindMapEvidenceGateway.batchRemove(docId, nodeIds)

    // 清理本地计数缓存
    for (const nid of nodeIds) {
      delete evidenceCounts.value[nid]
    }
    const nextCountCache = { ...countCacheByNodeId.value }
    for (const nid of nodeIds) {
      delete nextCountCache[nid]
    }
    countCacheByNodeId.value = nextCountCache

    // 清理列表缓存（节点被删，引用列表也应无效）
    const next = { ...evidencesByNodeId.value }
    for (const nid of nodeIds) {
      delete next[nid]
    }
    evidencesByNodeId.value = next
    const nextListCache = { ...listCacheByNodeId.value }
    for (const nid of nodeIds) {
      delete nextListCache[nid]
    }
    listCacheByNodeId.value = nextListCache

    // 同步清理展开状态
    const expandedNext = { ...expandedByNodeId.value }
    for (const nid of nodeIds) {
      delete expandedNext[nid]
    }
    expandedByNodeId.value = expandedNext
  }

  /**
   * 克隆引用 (节点复制时调用)
   */
  async function cloneEvidence(sourceNodeId: string, targetNodeId: string) {
    const docId = mindMapStore.currentDocumentId
    if (!docId) return

    await mindMapEvidenceGateway.clone(docId, sourceNodeId, targetNodeId)

    // 这里没法立即拿到 count，因为后端是批量插入
    // 可以选择手动发一次 count 请求，或者暂时置空
    const sourceCount = evidenceCounts.value[sourceNodeId] || 0
    if (sourceCount > 0) {
      // 乐观更新：假设全部复制成功
      evidenceCounts.value[targetNodeId] = sourceCount
      countCacheByNodeId.value = {
        ...countCacheByNodeId.value,
        [targetNodeId]: { status: 'loaded', updatedAt: Date.now() },
      }
    }
    // 中文说明：后端会生成新条目（id 变化），本地无法可靠合成列表，直接失效缓存，等待下一次加载。
    const next = { ...evidencesByNodeId.value }
    delete next[targetNodeId]
    evidencesByNodeId.value = next
    const nextListCache = { ...listCacheByNodeId.value }
    delete nextListCache[targetNodeId]
    listCacheByNodeId.value = nextListCache
  }

  /**
   * 软删除（用于支持撤销，删除时调用）
   */
  async function softDelete(nodeIds: string[]) {
    const docId = mindMapStore.currentDocumentId
    if (!docId) return

    await mindMapEvidenceGateway.softDelete(docId, nodeIds)
    // 软删除后 count 清零（UI 上不显示）
    for (const nid of nodeIds) {
      evidenceCounts.value[nid] = 0
    }
    const now = Date.now()
    const nextCountCache = { ...countCacheByNodeId.value }
    for (const nid of nodeIds) {
      nextCountCache[nid] = { status: 'loaded', updatedAt: now }
    }
    countCacheByNodeId.value = nextCountCache
    // 同步失效列表缓存（避免 UI 仍显示旧预览）
    const next = { ...evidencesByNodeId.value }
    for (const nid of nodeIds) {
      delete next[nid]
    }
    evidencesByNodeId.value = next
    const nextListCache = { ...listCacheByNodeId.value }
    for (const nid of nodeIds) {
      delete nextListCache[nid]
    }
    listCacheByNodeId.value = nextListCache

    // 软删除后也应收起（避免 UI 仍显示旧展开壳）
    const expandedNext = { ...expandedByNodeId.value }
    for (const nid of nodeIds) {
      expandedNext[nid] = false
    }
    expandedByNodeId.value = expandedNext
  }

  /**
   * 恢复软删除（用于 undo）
   */
  async function restoreSoftDeleted(nodeIds: string[]) {
    const docId = mindMapStore.currentDocumentId
    if (!docId) return

    await mindMapEvidenceGateway.restore(docId, nodeIds)
    // 恢复后重新拉一次 count
    await loadCounts(nodeIds)
    // 列表同样失效（后端恢复后需重新 list）
    const next = { ...evidencesByNodeId.value }
    for (const nid of nodeIds) {
      delete next[nid]
    }
    evidencesByNodeId.value = next
    const nextListCache = { ...listCacheByNodeId.value }
    for (const nid of nodeIds) {
      delete nextListCache[nid]
    }
    listCacheByNodeId.value = nextListCache
  }

  /**
   * 移动引用（用于剪切粘贴）
   */
  async function moveEvidence(sourceNodeId: string, targetNodeId: string) {
    const docId = mindMapStore.currentDocumentId
    if (!docId) return

    await mindMapEvidenceGateway.move(docId, sourceNodeId, targetNodeId)

    // 更新 count：源节点清零，目标节点累加
    const sourceCount = evidenceCounts.value[sourceNodeId] || 0
    evidenceCounts.value[sourceNodeId] = 0
    evidenceCounts.value[targetNodeId] = (evidenceCounts.value[targetNodeId] || 0) + sourceCount
    const now = Date.now()
    countCacheByNodeId.value = {
      ...countCacheByNodeId.value,
      [sourceNodeId]: { status: 'loaded', updatedAt: now },
      [targetNodeId]: { status: 'loaded', updatedAt: now },
    }
    // 列表缓存失效（移动后列表归属变化，必须重新 list）
    const next = { ...evidencesByNodeId.value }
    delete next[sourceNodeId]
    delete next[targetNodeId]
    evidencesByNodeId.value = next
    const nextListCache = { ...listCacheByNodeId.value }
    delete nextListCache[sourceNodeId]
    delete nextListCache[targetNodeId]
    listCacheByNodeId.value = nextListCache
  }

  function setNodeExpanded(nodeId: string, expanded: boolean) {
    expandedByNodeId.value = { ...expandedByNodeId.value, [nodeId]: expanded }
  }

  return {
    evidenceCounts,
    countCacheByNodeId,
    expandedByNodeId,
    evidencesByNodeId,
    isLoading,
    listCacheByNodeId,

    resetCache,
    loadCounts,
    loadEvidences,
    addEvidence,
    updateEvidence,
    removeEvidence,
    batchRemove,
    cloneEvidence,
    softDelete,
    restoreSoftDeleted,
    moveEvidence,

    setNodeExpanded,

    // selectors（缓存契约暴露面）
    getCountStatus,
    isCountKnown,
    getCount,
    getListStatus,
    getList,
  }
})
