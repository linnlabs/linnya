import type { BlockHistoryUiState } from '../store/useBlockHistoryStore'

export type BlockHistoryUiStateByBlockId = Readonly<Record<string, BlockHistoryUiState | undefined>>

/**
 * 从块历史 UI 状态中提取正在显示历史模式的 rootBlock。
 *
 * 中文说明：BlockChromeHost 只关心“哪些块需要 chrome 不能被回收”，不应该读取
 * History 组件内部状态或 DOM。这里把规则收束成纯函数，便于后续替换 Store 实现。
 */
export function readHistoryModeBlockIds(
  uiStateByBlockId: BlockHistoryUiStateByBlockId
): string[] {
  const blockIds: string[] = []

  Object.entries(uiStateByBlockId).forEach(([blockId, state]) => {
    if (!blockId || !state || state.mode === 'none') return
    blockIds.push(blockId)
  })

  return blockIds
}
