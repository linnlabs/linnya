import { computed, nextTick, ref } from 'vue'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Editor } from '@tiptap/vue-3'
import { useBlockRevision, type BlockRevisionProps } from './useBlockRevision'
import type { BlockRevisionState, PendingProjectionResult, RevisionStore } from '../../features/Revision/store/useRevisionStore'

const useRevisionStoreMock = vi.fn()

vi.mock('../../features/Revision/store/useRevisionStore', () => ({
  useRevisionStore: (editor: Editor) => useRevisionStoreMock(editor),
}))

function createRevisionStoreMock(): RevisionStore {
  const emptyProjectionResult: PendingProjectionResult = {
    requestedCount: 0,
    batchCount: 0,
    projectedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    totalMs: 0,
    flushMs: 0,
  }

  return {
    canonicalPendingSessions: ref({}),
    canonicalPendingBlockCount: computed(() => 0),
    canonicalHasAnyPending: computed(() => false),
    canonicalPendingStats: computed(() => ({ insertCount: 0, deleteCount: 0 })),
    activeRevisionCount: computed(() => 0),
    pendingProjectionDeferred: computed(() => false),
    hasCanonicalPending: vi.fn((blockId: string) => blockId === 'block-b'),
    getCanonicalSession: vi.fn(() => null),
    startRevision: vi.fn(),
    getRevisionState: vi.fn((blockId: string) => {
      if (blockId !== 'block-b') return null
      const state: BlockRevisionState = {
        blockId,
        revisionId: 'ai-pending-b',
        status: 'pending',
        diffStats: { insertCount: 2, deleteCount: 1 },
        createdAt: 1,
      }
      return state
    }),
    hasPendingRevision: vi.fn((blockId: string) => blockId === 'block-b'),
    acceptAllRevisions: vi.fn(async () => {}),
    rejectAllRevisions: vi.fn(async () => {}),
    acceptAllRevisionsInDocument: vi.fn(async () => 'applied' as const),
    rejectAllRevisionsInDocument: vi.fn(async () => 'applied' as const),
    acceptSingleRevision: vi.fn(async () => {}),
    rejectSingleRevision: vi.fn(async () => {}),
    clearRevision: vi.fn(),
    clearAllRevisions: vi.fn(),
    updateDiffStats: vi.fn(),
    clearBackendPendingForBlock: vi.fn(async () => {}),
    setWorkspacePendingRevisions: vi.fn(),
    projectPendingRevisionsForBlocks: vi.fn(async () => emptyProjectionResult),
    findRootBlockPos: vi.fn(() => null),
    reconcileCanonicalWithDocument: vi.fn(),
  }
}

describe('useBlockRevision', () => {
  beforeEach(() => {
    useRevisionStoreMock.mockReset()
  })

  it('tracks the current blockId when the node view instance is rebound to another block', async () => {
    const store = createRevisionStoreMock()
    useRevisionStoreMock.mockReturnValue(store)

    const editor = {} as Editor
    const currentBlockId = ref('block-a')
    const props = computed<BlockRevisionProps>(() => ({
      editor,
      blockId: currentBlockId.value,
    }))

    const revision = useBlockRevision({
      props,
      enabled: computed(() => true),
    })

    expect(revision.hasPendingRevision.value).toBe(false)
    expect(revision.blockRevisionState.value).toBeNull()

    currentBlockId.value = 'block-b'
    await nextTick()

    expect(revision.hasPendingRevision.value).toBe(true)
    expect(revision.blockRevisionState.value?.blockId).toBe('block-b')
    expect(revision.revisionDiffStats.value).toEqual({ insertCount: 2, deleteCount: 1 })

    await revision.handleAcceptAllRevisions()

    expect(store.acceptAllRevisions).toHaveBeenCalledWith('block-b')
    expect(store.hasCanonicalPending).toHaveBeenCalledWith('block-b')
    expect(store.getRevisionState).toHaveBeenCalledWith('block-b')
    expect(store.projectPendingRevisionsForBlocks).not.toHaveBeenCalled()
  })

  it('projects a canonical-only pending revision when the block becomes active', async () => {
    const store = createRevisionStoreMock()
    store.getRevisionState = vi.fn(() => null)
    useRevisionStoreMock.mockReturnValue(store)

    const editor = {} as Editor
    const props = computed<BlockRevisionProps>(() => ({
      editor,
      blockId: 'block-b',
    }))

    useBlockRevision({
      props,
      enabled: computed(() => true),
    })

    await nextTick()

    expect(store.projectPendingRevisionsForBlocks).toHaveBeenCalledWith(['block-b'])
  })
})
