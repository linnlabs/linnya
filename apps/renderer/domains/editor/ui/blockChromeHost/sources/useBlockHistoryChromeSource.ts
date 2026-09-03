import type { ComputedRef } from 'vue'
import { useHistoryModeRootBlockIds } from '../../../features/BlockHistory/readModel'

/**
 * 块历史模式对应的 active chrome 来源。
 *
 * 中文说明：历史模式可能让块在视口外也保持交互 UI，因此 Host 需要把它作为独立来源记录。
 */
export function useBlockHistoryChromeSource(): ComputedRef<string[]> {
  return useHistoryModeRootBlockIds()
}
