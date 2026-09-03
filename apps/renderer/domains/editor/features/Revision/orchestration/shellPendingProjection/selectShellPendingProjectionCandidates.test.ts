import { describe, expect, it } from 'vitest'
import type { BlockRevisionState } from '../../store/types'
import { selectShellPendingProjectionCandidates } from './selectShellPendingProjectionCandidates'

function createStore(params: {
  pendingBlockIds: readonly string[]
  activeBlockIds?: readonly string[]
}): {
  hasCanonicalPending: (blockId: string) => boolean
  getRevisionState: (blockId: string) => Pick<BlockRevisionState, 'status'> | null
} {
  const pendingBlockIds = new Set(params.pendingBlockIds)
  const activeBlockIds = new Set(params.activeBlockIds ?? [])

  return {
    hasCanonicalPending: (blockId: string) => pendingBlockIds.has(blockId),
    getRevisionState: (blockId: string) => activeBlockIds.has(blockId)
      ? { status: 'pending' }
      : null,
  }
}

describe('selectShellPendingProjectionCandidates', () => {
  it('deduplicates hydrated ids and separates active or non-pending blocks', () => {
    const store = createStore({
      pendingBlockIds: ['root-a', 'root-b', 'root-c'],
      activeBlockIds: ['root-b'],
    })

    const result = selectShellPendingProjectionCandidates(store, [
      'root-a',
      'root-a',
      'root-b',
      'root-x',
      'root-c',
    ])

    expect(result.candidateBlockIds).toEqual(['root-a', 'root-c'])
    expect(result.skippedActiveBlockIds).toEqual(['root-b'])
    expect(result.skippedNonPendingBlockIds).toEqual(['root-x'])
    expect(result.skippedActiveCount).toBe(1)
    expect(result.skippedNonPendingCount).toBe(1)
  })
})
