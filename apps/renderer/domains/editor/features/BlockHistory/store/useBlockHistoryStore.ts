/**
 * @file useBlockHistoryStore.ts
 * @description 块级版本历史的状态管理
 *
 * 管理块的历史版本数据和时光机 UI 状态：
 * - 从后端加载版本列表
 * - 控制时光机视图模式（side-by-side / overlay / multi-column）
 * - 支持版本恢复操作
 *
 * 设计原则：
 * - 历史版本只作为外部快照，不进入 ProseMirror schema
 * - 当前文档中的 RootBlock 永远只表示"当前版本"
 */

import { ref, computed, type Ref, type ComputedRef } from 'vue'
import {
  blockHistoryGateway,
  type BlockVersion,
  type CreateBlockVersionParams,
} from '../../../../../shared/ipc/blockHistoryGateway'

// ==================== 类型定义 ====================

/** 时光机视图模式 */
export type HistoryViewMode = 'none' | 'side-by-side' | 'overlay' | 'multi-column'

/** 单个块的时光机 UI 状态 */
export interface BlockHistoryUiState {
  /** 视图模式 */
  mode: HistoryViewMode
  /** 单版本视图下当前选中的版本（用于 side-by-side / overlay） */
  selectedVersionId?: string
  /** 多栏视图下选中的多个版本（用于 multi-column） */
  selectedVersionIds?: string[]
  /** 当前关注的"行"下标（逻辑行索引） */
  focusedLineIndex?: number
  /** 是否正在从后端加载 */
  isLoading: boolean
}

/** Store 返回类型 */
export interface BlockHistoryStore {
  // 状态
  versionsByBlock: Ref<Record<string, BlockVersion[]>>
  uiStateByBlock: Ref<Record<string, BlockHistoryUiState>>

  // 计算属性
  hasAnyHistoryMode: ComputedRef<boolean>

  // 方法
  loadBlockHistory: (documentNodeId: string, blockId: string) => Promise<void>
  getVersions: (blockId: string) => BlockVersion[]
  getUiState: (blockId: string) => BlockHistoryUiState
  setViewMode: (blockId: string, mode: HistoryViewMode) => void
  selectVersion: (blockId: string, versionId: string) => void
  selectMultipleVersions: (blockId: string, versionIds: string[]) => void
  setFocusedLineIndex: (blockId: string, lineIndex: number) => void
  restoreVersion: (documentNodeId: string, blockId: string, versionId: string) => Promise<BlockVersion | null>
  createVersion: (params: CreateBlockVersionParams) => Promise<BlockVersion | null>
  exitHistoryMode: (blockId: string) => void
  clearBlockHistory: (blockId: string) => void
  isInHistoryMode: (blockId: string) => boolean
  deleteVersion: (versionId: string) => Promise<void>
}

// ==================== 默认 UI 状态 ====================

function getDefaultUiState(): BlockHistoryUiState {
  return {
    mode: 'none',
    selectedVersionId: undefined,
    selectedVersionIds: undefined,
    focusedLineIndex: undefined,
    isLoading: false,
  }
}

// ==================== 单例管理 ====================

/**
 * 全局单例实例。
 *
 * 说明：
 * - BlockHistory 状态需要在「块视图组件」「块菜单 Provider」「时光机 UI」之间共享；
 * - 如果每次调用 useBlockHistoryStore 都创建一个新实例，状态会彼此隔离，导致：
 *   - 菜单里调用 setViewMode 后，BlockView 感知不到；
 *   - UI 组件的 isActive 一直为 false，看起来「什么都没发生」。
 * - 因此这里采用简单的模块级单例，确保整个 renderer 进程共用同一份 Store。
 */
let singletonStore: BlockHistoryStore | null = null

// ==================== Store 实现 ====================

/**
 * 真正创建块历史状态 Store 的工厂函数。
 * 外部不要直接调用，只通过 useBlockHistoryStore 获取单例。
 */
function createBlockHistoryStore(): BlockHistoryStore {
  // 响应式状态
  const versionsByBlock = ref<Record<string, BlockVersion[]>>({})
  const uiStateByBlock = ref<Record<string, BlockHistoryUiState>>({})
  const inFlightLoads = new Map<string, Promise<void>>()

  // ==================== 计算属性 ====================

  /** 是否有任何块处于历史模式 */
  const hasAnyHistoryMode = computed(() => {
    return Object.values(uiStateByBlock.value).some((s) => s.mode !== 'none')
  })

  // ==================== 方法 ====================

  /**
   * 从后端加载块的历史版本
   */
  async function loadBlockHistory(documentNodeId: string, blockId: string): Promise<void> {
    const requestKey = `${documentNodeId}::${blockId}`
    const existingLoad = inFlightLoads.get(requestKey)
    if (existingLoad) {
      return existingLoad
    }

    // 初始化 UI 状态
    if (!uiStateByBlock.value[blockId]) {
      uiStateByBlock.value[blockId] = getDefaultUiState()
    }

    const loadPromise = (async () => {
      // 设置加载状态
      uiStateByBlock.value[blockId].isLoading = true

      try {
        const result = await blockHistoryGateway.listVersions({ documentNodeId, targetBlockId: blockId })

        if (result.success) {
          versionsByBlock.value[blockId] = result.data
        } else {
          console.error('[BlockHistoryStore] 加载历史版本失败:', result.error)
          versionsByBlock.value[blockId] = []
        }
      } catch (error) {
        console.error('[BlockHistoryStore] 加载历史版本异常:', error)
        versionsByBlock.value[blockId] = []
      } finally {
        uiStateByBlock.value[blockId].isLoading = false
        inFlightLoads.delete(requestKey)
      }
    })()

    inFlightLoads.set(requestKey, loadPromise)
    return loadPromise
  }

  /**
   * 获取块的版本列表
   */
  function getVersions(blockId: string): BlockVersion[] {
    return versionsByBlock.value[blockId] || []
  }

  /**
   * 获取块的 UI 状态
   */
  function getUiState(blockId: string): BlockHistoryUiState {
    return uiStateByBlock.value[blockId] || getDefaultUiState()
  }

  /**
   * 设置视图模式
   */
  function setViewMode(blockId: string, mode: HistoryViewMode): void {
    if (!uiStateByBlock.value[blockId]) {
      uiStateByBlock.value[blockId] = getDefaultUiState()
    }
    // 确保响应式更新
    uiStateByBlock.value[blockId] = {
      ...uiStateByBlock.value[blockId],
      mode
    };
  }

  /**
   * 选择单个版本（用于 side-by-side / overlay）
   */
  function selectVersion(blockId: string, versionId: string): void {
    if (!uiStateByBlock.value[blockId]) {
      uiStateByBlock.value[blockId] = getDefaultUiState()
    }
    // 确保响应式更新
    uiStateByBlock.value[blockId] = {
      ...uiStateByBlock.value[blockId],
      selectedVersionId: versionId
    };
  }

  /**
   * 选择多个版本（用于 multi-column）
   */
  function selectMultipleVersions(blockId: string, versionIds: string[]): void {
    if (!uiStateByBlock.value[blockId]) {
      uiStateByBlock.value[blockId] = getDefaultUiState()
    }
    uiStateByBlock.value[blockId].selectedVersionIds = versionIds
  }

  /**
   * 设置当前关注的行索引
   */
  function setFocusedLineIndex(blockId: string, lineIndex: number): void {
    if (!uiStateByBlock.value[blockId]) {
      uiStateByBlock.value[blockId] = getDefaultUiState()
    }
    uiStateByBlock.value[blockId].focusedLineIndex = lineIndex
  }

  /**
   * 恢复到指定版本
   */
  async function restoreVersion(
    documentNodeId: string,
    blockId: string,
    versionId: string
  ): Promise<BlockVersion | null> {
    console.log('[BlockHistoryStore] Requesting restoreVersion:', { blockId, versionId });
    try {
      const result = await blockHistoryGateway.restoreVersion({
        documentNodeId,
        targetBlockId: blockId,
        sourceVersionId: versionId,
      })

      if (result.success) {
        console.log('[BlockHistoryStore] Restore successful, new version created:', result.data.version_number);
        // 重新加载版本列表
        await loadBlockHistory(documentNodeId, blockId)
        return result.data
      } else {
        console.error('[BlockHistoryStore] 恢复版本失败:', result.error)
        return null
      }
    } catch (error) {
      console.error('[BlockHistoryStore] 恢复版本异常:', error)
      return null
    }
  }

  /**
   * 创建新版本
   */
  async function createVersion(params: CreateBlockVersionParams): Promise<BlockVersion | null> {
    try {
      const result = await blockHistoryGateway.createVersion(params)

      if (result.success) {
        // 更新本地缓存
        const blockId = params.targetBlockId
        if (!versionsByBlock.value[blockId]) {
          versionsByBlock.value[blockId] = []
        }
        // 新版本插入到列表开头（最新在前）
        versionsByBlock.value[blockId].unshift(result.data)
        return result.data
      } else {
        console.error('[BlockHistoryStore] 创建版本失败:', result.error)
        return null
      }
    } catch (error) {
      console.error('[BlockHistoryStore] 创建版本异常:', error)
      return null
    }
  }

  /**
   * 退出历史模式
   */
  function exitHistoryMode(blockId: string): void {
    if (uiStateByBlock.value[blockId]) {
      uiStateByBlock.value[blockId] = {
        ...uiStateByBlock.value[blockId],
        mode: 'none',
        selectedVersionId: undefined,
        selectedVersionIds: undefined,
        focusedLineIndex: undefined,
      }
    }
  }

  /**
   * 清除块的历史数据
   */
  function clearBlockHistory(blockId: string): void {
    delete versionsByBlock.value[blockId]
    delete uiStateByBlock.value[blockId]
  }

  /**
   * 检查块是否处于历史模式
   */
  function isInHistoryMode(blockId: string): boolean {
    const state = uiStateByBlock.value[blockId]
    return state?.mode !== 'none' && state?.mode !== undefined
  }

  /**
   * 删除指定版本
   *
   * 需求：
   * - 调用后端删除指定版本
   * - 本地 versionsByBlock 中移除该版本
   * - 如果当前选中版本被删除，自动跳转到“最近”的一个版本
   *   - 优先选择同一列表中紧挨着的下一个版本
   *   - 如果下一个不存在，则选择上一个
   */
  async function deleteVersion(versionId: string): Promise<void> {
    // 找到该版本所属的块以及在列表中的下标
    let targetBlockId: string | null = null
    let targetIndex = -1

    for (const [blockId, versions] of Object.entries(versionsByBlock.value)) {
      const index = versions.findIndex((version) => version.id === versionId)
      if (index !== -1) {
        targetBlockId = blockId
        targetIndex = index
        break
      }
    }

    if (!targetBlockId || targetIndex === -1) {
      console.warn('[BlockHistoryStore] deleteVersion: 未在本地缓存中找到目标版本', versionId)
      // 依然尝试通知后端删除，以防只是本地状态缺失
      await blockHistoryGateway.deleteVersion({ versionId })
      return
    }

    try {
      const result = await blockHistoryGateway.deleteVersion({ versionId })
      if (!result.success) {
        console.error('[BlockHistoryStore] 删除版本失败:', result.error)
        return
      }
    } catch (error) {
      console.error('[BlockHistoryStore] 删除版本异常:', error)
      return
    }

    const currentVersions = versionsByBlock.value[targetBlockId] ?? []
    if (!currentVersions.length) {
      return
    }

    const newVersions = [...currentVersions]
    newVersions.splice(targetIndex, 1)
    versionsByBlock.value[targetBlockId] = newVersions

    // 处理“自动跳到最近的版本”的逻辑
    const uiState = uiStateByBlock.value[targetBlockId] ?? getDefaultUiState()
    const isDeletedSelected = uiState.selectedVersionId === versionId

    let nextSelectedId: string | undefined = uiState.selectedVersionId

    if (isDeletedSelected) {
      const neighbor =
        newVersions[targetIndex] ??
        newVersions[targetIndex - 1] ??
        null

      nextSelectedId = neighbor ? neighbor.id : undefined
    }

    uiStateByBlock.value[targetBlockId] = {
      ...uiState,
      selectedVersionId: nextSelectedId,
    }
  }

  return {
    // 状态
    versionsByBlock,
    uiStateByBlock,

    // 计算属性
    hasAnyHistoryMode,

    // 方法
    loadBlockHistory,
    getVersions,
    getUiState,
    setViewMode,
    selectVersion,
    selectMultipleVersions,
    setFocusedLineIndex,
    restoreVersion,
    createVersion,
    exitHistoryMode,
    clearBlockHistory,
    isInHistoryMode,
    deleteVersion,
  }
}

/**
 * 获取块历史状态 Store（单例）
 *
 * 设计：
 * - 与 RevisionStore 类似，通过模块级变量维护单例；
 * - 任何地方（BlockView、History* 组件、块菜单 Provider）调用此函数，都能拿到同一实例；
 * - 避免出现「菜单设置了 mode，但视图组件读到的还是默认 none」的问题。
 */
export function useBlockHistoryStore(): BlockHistoryStore {
  if (!singletonStore) {
    singletonStore = createBlockHistoryStore()
  }
  return singletonStore
}

export default useBlockHistoryStore
