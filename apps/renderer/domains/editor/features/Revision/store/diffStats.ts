/**
 * @file diffStats.ts
 * @description diff 统计更新逻辑（从 useRevisionStore.ts 拆出）。
 */

import type { Ref } from 'vue'
import type { RevisionChangeType } from '../../../extensions/revision/RevisionMark'
import type { BlockRevisionState } from './types'

export function updateDiffStats(
  activeRevisions: Ref<Record<string, BlockRevisionState>>,
  blockId: string,
  insertCount: number,
  deleteCount: number
): void {
  const state = activeRevisions.value[blockId]
  if (!state) return

  activeRevisions.value[blockId] = {
    ...state,
    diffStats: { insertCount, deleteCount },
  }
}

export function updateDiffStatsAfterSingleAction(
  activeRevisions: Ref<Record<string, BlockRevisionState>>,
  blockId: string,
  changeType: RevisionChangeType,
  action: 'accept' | 'reject'
): void {
  const state = activeRevisions.value[blockId]
  if (!state?.diffStats) return

  const { insertCount, deleteCount } = state.diffStats

  if (changeType === 'insert') {
    activeRevisions.value[blockId] = {
      ...state,
      diffStats: {
        insertCount: Math.max(0, insertCount - 1),
        deleteCount,
      },
    }
  } else {
    activeRevisions.value[blockId] = {
      ...state,
      diffStats: {
        insertCount,
        deleteCount: Math.max(0, deleteCount - 1),
      },
    }
  }

  const newStats = activeRevisions.value[blockId].diffStats
  if (newStats && newStats.insertCount === 0 && newStats.deleteCount === 0) {
    activeRevisions.value[blockId] = {
      ...activeRevisions.value[blockId],
      status: action === 'accept' ? 'applied' : 'discarded',
    }
  } else {
    // 强制保持 pending 状态，防止 getRevisionState 错误校正
    activeRevisions.value[blockId] = {
      ...activeRevisions.value[blockId],
      status: 'pending',
    }
  }
}


