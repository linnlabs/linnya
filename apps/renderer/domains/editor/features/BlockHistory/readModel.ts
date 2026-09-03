import { computed, type ComputedRef } from 'vue'
import type { BlockVersionHandleSummary } from './definitions/blockVersionHandleSummary'
import { readBlockVersionHandleSummary } from './functions/readBlockVersionHandleSummary'
import { readHistoryModeBlockIds } from './functions/readHistoryModeBlockIds'
import { useBlockHistoryStore } from './store/useBlockHistoryStore'

/**
 * 块历史 feature 的只读运行态。
 *
 * 中文说明：Stage 3 的 BlockChromeHost 需要知道“哪些块因为历史模式必须保持 chrome”。
 * 这里暴露窄读模型，避免 Host 直接依赖 History UI 组件或遍历 DOM。
 */
export function useHistoryModeRootBlockIds(): ComputedRef<string[]> {
  const store = useBlockHistoryStore()

  return computed(() => {
    return readHistoryModeBlockIds(store.uiStateByBlock.value)
  })
}

/**
 * 块历史版本入口的只读摘要。
 *
 * 中文说明：这是 Stage 3 left-handle 迁移的窄出口；
 * Host 只按 blockId 读取展示摘要，不直接依赖 History store 内部结构。
 */
export function useBlockVersionHandleSummary(
  blockId: ComputedRef<string | null | undefined>
): ComputedRef<BlockVersionHandleSummary> {
  const store = useBlockHistoryStore()

  return computed(() => {
    const currentBlockId = blockId.value?.trim()
    if (!currentBlockId) return readBlockVersionHandleSummary([])

    return readBlockVersionHandleSummary(store.getVersions(currentBlockId))
  })
}
