import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRevisionStore } from '../useRevisionStore'
import type { BlockRevisionState } from '../types'

const mocks = vi.hoisted(() => {
  const fileStore = {
    currentFilePath: 'doc-1' as string | null,
    setDirty: vi.fn(),
  }

  return {
    fileStore,
    hydrateRootBlockForInteraction: vi.fn(),
    projectPendingRevisionsForBlocks: vi.fn(),
    findRootBlockPosById: vi.fn(),
    requestSave: vi.fn(),
    clearPendingRevision: vi.fn(),
    clearAllPendingRevisions: vi.fn(),
    applyPendingRevision: vi.fn(),
    setPendingRevisionsBatch: vi.fn(),
    applyAllPendingRevisions: vi.fn(),
    readDocument: vi.fn(),
    scanBlockForRevisions: vi.fn(),
  }
})

vi.mock('../../../../../../shared/stores/file', () => ({
  useFileStore: () => mocks.fileStore,
}))

vi.mock('../../../../../../shared/ipc/workspaceGateway', () => ({
  workspaceGateway: {
    'apply-all-pending-revisions': mocks.applyAllPendingRevisions,
    'clear-pending-revision': mocks.clearPendingRevision,
    'clear-all-pending-revisions': mocks.clearAllPendingRevisions,
    'apply-pending-revision': mocks.applyPendingRevision,
    'set-pending-revisions-batch': mocks.setPendingRevisionsBatch,
    'read-document': mocks.readDocument,
  },
}))

vi.mock('../../../../../workspace/services/file-manager/index', () => ({
  requestSave: mocks.requestSave,
}))

vi.mock('../../../RenderVirtualization', () => ({
  hydrateRootBlockForInteraction: mocks.hydrateRootBlockForInteraction,
}))

vi.mock('../../utils/pending/pendingRevisionHelpers', () => ({
  findRootBlockPosById: mocks.findRootBlockPosById,
}))

vi.mock('../revisionMarkScan', () => ({
  scanBlockForRevisions: mocks.scanBlockForRevisions,
}))

vi.mock('../pendingProjectionWindow', () => ({
  projectPendingRevisionsForBlocks: mocks.projectPendingRevisionsForBlocks,
}))

function createEditor() {
  const dispatch = vi.fn()
  const tr = {
    delete: vi.fn(() => tr),
  }
  return {
    commands: {
      setContent: vi.fn(() => true),
      acceptAllRevisionsInBlock: vi.fn(() => true),
      rejectAllRevisionsInBlock: vi.fn(() => true),
      clearBlockRevisionMarks: vi.fn(() => true),
    },
    on: vi.fn(),
    state: {
      doc: {
        childCount: 0,
        child: vi.fn(),
        nodeAt: vi.fn(),
      },
      tr,
    },
    view: {
      dispatch,
    },
    chain: vi.fn(),
  }
}

describe('useRevisionStore block-level revision actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fileStore.currentFilePath = 'doc-1'
    mocks.hydrateRootBlockForInteraction.mockResolvedValue({ ok: true, blockId: 'b1', pos: 3 })
    mocks.findRootBlockPosById.mockReturnValue(3)
    mocks.requestSave.mockResolvedValue(true)
    mocks.clearPendingRevision.mockResolvedValue({
      success: true,
      data: { deletedCount: 1 },
    })
    mocks.applyPendingRevision.mockResolvedValue({
      success: true,
      data: {
        status: 'ok',
        documentId: 'doc-1',
        blockId: 'b1',
        appliedCount: 1,
        skippedCount: 0,
        failedCount: 0,
      },
    })
    mocks.projectPendingRevisionsForBlocks.mockImplementation(async (params: {
      blockIds: string[]
      activeRevisions: { value: Record<string, BlockRevisionState> }
    }) => {
      const blockId = params.blockIds[0]
      if (!blockId) {
        return {
          requestedCount: params.blockIds.length,
          batchCount: 0,
          projectedCount: 0,
          skippedCount: params.blockIds.length,
          failedCount: 0,
          totalMs: 0,
          flushMs: 0,
        }
      }
      params.activeRevisions.value[blockId] = {
        blockId,
        revisionId: 'ai-p1',
        status: 'pending',
        operation: 'update',
        createdAt: 1,
      }
      return {
        requestedCount: params.blockIds.length,
        batchCount: 1,
        projectedCount: 1,
        skippedCount: 0,
        failedCount: 0,
        totalMs: 0,
        flushMs: 0,
      }
    })
    mocks.scanBlockForRevisions.mockReturnValue(null)
  })

  it('hydrates and projects canonical-only pending before accepting a block', async () => {
    const editor = createEditor()
    const store = useRevisionStore(editor as unknown as Parameters<typeof useRevisionStore>[0])
    store.canonicalPendingSessions.value = {
      b1: {
        pendingId: 'p1',
        blockId: 'b1',
        operation: 'update',
        revisionId: 'ai-p1',
        createdAt: 1,
      },
    }

    await store.acceptAllRevisions('b1')

    expect(mocks.hydrateRootBlockForInteraction).toHaveBeenCalledWith(editor, 'b1', {
      temporaryPinMs: 800,
    })
    expect(mocks.projectPendingRevisionsForBlocks).toHaveBeenCalledTimes(1)
    expect(editor.commands.acceptAllRevisionsInBlock).toHaveBeenCalledWith(3, 'ai-p1')
    expect(store.canonicalPendingBlockCount.value).toBe(0)
    expect(mocks.applyPendingRevision).toHaveBeenCalledWith({
      documentId: 'doc-1',
      blockId: 'b1',
      mode: 'accept',
    })
    expect(mocks.requestSave).not.toHaveBeenCalled()
    expect(mocks.clearPendingRevision).not.toHaveBeenCalled()
  })

  it('falls back to full save when backend single-block apply reports no applied pending', async () => {
    mocks.applyPendingRevision.mockResolvedValueOnce({
      success: true,
      data: {
        status: 'ok',
        documentId: 'doc-1',
        blockId: 'b1',
        appliedCount: 0,
        skippedCount: 1,
        failedCount: 0,
      },
    })
    const editor = createEditor()
    const store = useRevisionStore(editor as unknown as Parameters<typeof useRevisionStore>[0])
    store.canonicalPendingSessions.value = {
      b1: {
        pendingId: 'p1',
        blockId: 'b1',
        operation: 'update',
        revisionId: 'ai-p1',
        createdAt: 1,
      },
    }

    await store.acceptAllRevisions('b1')

    expect(mocks.applyPendingRevision).toHaveBeenCalledWith({
      documentId: 'doc-1',
      blockId: 'b1',
      mode: 'accept',
    })
    expect(mocks.requestSave).toHaveBeenCalledTimes(1)
    expect(mocks.clearPendingRevision).toHaveBeenCalledWith({
      documentId: 'doc-1',
      blockId: 'b1',
    })
  })

  it('skips hydrate handshake for document-level fallback batches', async () => {
    const editor = createEditor()
    const store = useRevisionStore(editor as unknown as Parameters<typeof useRevisionStore>[0])
    store.canonicalPendingSessions.value = {
      b1: {
        pendingId: 'p1',
        blockId: 'b1',
        operation: 'update',
        revisionId: 'ai-p1',
        createdAt: 1,
      },
    }

    await store.acceptAllRevisions('b1', {
      deferBackendClear: true,
      deferSave: true,
      hydrateForInteraction: false,
    })

    expect(mocks.hydrateRootBlockForInteraction).not.toHaveBeenCalled()
    expect(editor.commands.acceptAllRevisionsInBlock).toHaveBeenCalledWith(3, 'ai-p1')
    expect(mocks.requestSave).not.toHaveBeenCalled()
    expect(mocks.clearPendingRevision).not.toHaveBeenCalled()
  })

  it('rejects canonical-only update pending without projecting revision marks', async () => {
    const editor = createEditor()
    const store = useRevisionStore(editor as unknown as Parameters<typeof useRevisionStore>[0])
    store.canonicalPendingSessions.value = {
      b1: {
        pendingId: 'p1',
        blockId: 'b1',
        operation: 'update',
        revisionId: 'ai-p1',
        createdAt: 1,
      },
    }

    await store.rejectAllRevisions('b1')

    expect(mocks.hydrateRootBlockForInteraction).not.toHaveBeenCalled()
    expect(mocks.projectPendingRevisionsForBlocks).not.toHaveBeenCalled()
    expect(editor.commands.rejectAllRevisionsInBlock).not.toHaveBeenCalled()
    expect(mocks.requestSave).not.toHaveBeenCalled()
    expect(mocks.applyPendingRevision).toHaveBeenCalledWith({
      documentId: 'doc-1',
      blockId: 'b1',
      mode: 'reject',
    })
    expect(mocks.clearPendingRevision).not.toHaveBeenCalled()
    expect(store.canonicalPendingBlockCount.value).toBe(0)
  })

  it('rejects canonical-only insert pending by deleting the placeholder block directly', async () => {
    const editor = createEditor()
    editor.state.doc.nodeAt.mockReturnValue({
      type: { name: 'rootBlock' },
      nodeSize: 8,
    })
    const store = useRevisionStore(editor as unknown as Parameters<typeof useRevisionStore>[0])
    store.canonicalPendingSessions.value = {
      b1: {
        pendingId: 'p1',
        blockId: 'b1',
        operation: 'insert',
        revisionId: 'ai-p1',
        createdAt: 1,
      },
    }

    await store.rejectAllRevisions('b1')

    expect(mocks.hydrateRootBlockForInteraction).not.toHaveBeenCalled()
    expect(mocks.projectPendingRevisionsForBlocks).not.toHaveBeenCalled()
    expect(editor.state.tr.delete).toHaveBeenCalledWith(3, 11)
    expect(editor.view.dispatch).toHaveBeenCalledWith(editor.state.tr)
    expect(mocks.applyPendingRevision).toHaveBeenCalledWith({
      documentId: 'doc-1',
      blockId: 'b1',
      mode: 'reject',
    })
    expect(mocks.requestSave).not.toHaveBeenCalled()
    expect(mocks.clearPendingRevision).not.toHaveBeenCalled()
    expect(store.canonicalPendingBlockCount.value).toBe(0)
  })

  it('accepts canonical-only delete pending by deleting the root block directly', async () => {
    const editor = createEditor()
    editor.state.doc.nodeAt.mockReturnValue({
      type: { name: 'rootBlock' },
      nodeSize: 8,
    })
    const store = useRevisionStore(editor as unknown as Parameters<typeof useRevisionStore>[0])
    store.canonicalPendingSessions.value = {
      b1: {
        pendingId: 'p1',
        blockId: 'b1',
        operation: 'delete',
        revisionId: 'ai-p1',
        createdAt: 1,
      },
    }

    await store.acceptAllRevisions('b1')

    expect(mocks.hydrateRootBlockForInteraction).not.toHaveBeenCalled()
    expect(mocks.projectPendingRevisionsForBlocks).not.toHaveBeenCalled()
    expect(editor.commands.acceptAllRevisionsInBlock).not.toHaveBeenCalled()
    expect(editor.state.tr.delete).toHaveBeenCalledWith(3, 11)
    expect(editor.view.dispatch).toHaveBeenCalledWith(editor.state.tr)
    expect(mocks.applyPendingRevision).toHaveBeenCalledWith({
      documentId: 'doc-1',
      blockId: 'b1',
      mode: 'accept',
    })
    expect(mocks.requestSave).not.toHaveBeenCalled()
    expect(mocks.clearPendingRevision).not.toHaveBeenCalled()
    expect(store.canonicalPendingBlockCount.value).toBe(0)
  })

  it('does not clear canonical or backend from getRevisionState when marks are temporarily absent', () => {
    const editor = createEditor()
    const store = useRevisionStore(editor as unknown as Parameters<typeof useRevisionStore>[0])
    store.canonicalPendingSessions.value = {
      b1: {
        pendingId: 'p1',
        blockId: 'b1',
        operation: 'update',
        revisionId: 'ai-p1',
        createdAt: 1,
      },
    }
    store.startRevision({
      blockId: 'b1',
      revisionId: 'ai-p1',
      operation: 'update',
      createdAt: 1,
      diffStats: {
        insertCount: 1,
        deleteCount: 0,
      },
    })

    const state = store.getRevisionState('b1')

    expect(state?.status).toBe('pending')
    expect(store.canonicalPendingBlockCount.value).toBe(1)
    expect(mocks.clearPendingRevision).not.toHaveBeenCalled()
  })
})
