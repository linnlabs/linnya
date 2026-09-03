import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  applyUpdatePendingRevision,
  batchApplyUpdatePendingRevisions,
  batchApplyNonInsertPendingRevisions,
} = vi.hoisted(() => ({
  applyUpdatePendingRevision: vi.fn(),
  batchApplyUpdatePendingRevisions: vi.fn(),
  batchApplyNonInsertPendingRevisions: vi.fn(),
}))

const {
  applyDeletePendingRevision,
} = vi.hoisted(() => ({
  applyDeletePendingRevision: vi.fn(),
}))

const {
  applyInsertPendingRevision,
  batchApplyInsertPendingRevisions,
} = vi.hoisted(() => ({
  applyInsertPendingRevision: vi.fn(),
  batchApplyInsertPendingRevisions: vi.fn(),
}))

vi.mock('../updatePendingRevisionApplier', () => ({
  applyUpdatePendingRevision,
  batchApplyUpdatePendingRevisions,
  batchApplyNonInsertPendingRevisions,
}))

vi.mock('../deletePendingRevisionApplier', () => ({
  applyDeletePendingRevision,
}))

vi.mock('../insertPendingRevisionApplier', () => ({
  applyInsertPendingRevision,
  batchApplyInsertPendingRevisions,
}))

import { applyPendingRevisionsToEditor } from '../applyPendingRevisions'

describe('applyPendingRevisionsToEditor', () => {
  beforeEach(() => {
    vi.mocked(applyUpdatePendingRevision).mockReset()
    vi.mocked(batchApplyUpdatePendingRevisions).mockReset()
    vi.mocked(batchApplyNonInsertPendingRevisions).mockReset()
    vi.mocked(applyDeletePendingRevision).mockReset()
    vi.mocked(applyInsertPendingRevision).mockReset()
    vi.mocked(batchApplyInsertPendingRevisions).mockReset()

    vi.mocked(batchApplyNonInsertPendingRevisions).mockImplementation(async (_editor, revisions) =>
      revisions.map((revision) => ({
        id: revision.id,
        success: true,
        operation: ((revision.metadata?.operation as 'update' | 'delete') || 'update'),
        blockId: revision.blockId,
      }))
    )
    vi.mocked(applyDeletePendingRevision).mockImplementation((_editor, revision) => ({
      id: revision.id,
      success: true,
      operation: 'delete',
      blockId: revision.blockId,
    }))
    vi.mocked(batchApplyInsertPendingRevisions).mockImplementation(async (_editor, revisions) =>
      revisions.map((revision) => ({
        id: revision.id,
        success: true,
        operation: 'insert' as const,
        blockId: revision.blockId,
      }))
    )
  })

  it('batches consecutive updates until a non-update boundary is reached, even when blockId repeats', async () => {
    const editor = {} as any

    const result = await applyPendingRevisionsToEditor(editor, [
      {
        id: 'u1',
        conversationId: 'conv',
        blockId: 'block-a',
        operation: 'update',
        originalMarkdown: '',
        newMarkdown: 'A1',
        metadata: { operation: 'update' },
      },
      {
        id: 'u2',
        conversationId: 'conv',
        blockId: 'block-b',
        operation: 'update',
        originalMarkdown: '',
        newMarkdown: 'B1',
        metadata: { operation: 'update' },
      },
      {
        id: 'u3',
        conversationId: 'conv',
        blockId: 'block-a',
        operation: 'update',
        originalMarkdown: 'A1',
        newMarkdown: 'A2',
        metadata: { operation: 'update' },
      },
      {
        id: 'd1',
        conversationId: 'conv',
        blockId: 'block-c',
        operation: 'delete',
        originalMarkdown: 'C',
        newMarkdown: '',
        metadata: { operation: 'delete' },
      },
      {
        id: 'u4',
        conversationId: 'conv',
        blockId: 'block-d',
        operation: 'update',
        originalMarkdown: '',
        newMarkdown: 'D1',
        metadata: { operation: 'update' },
      },
    ])

    expect(batchApplyNonInsertPendingRevisions).toHaveBeenCalledTimes(1)
    expect(vi.mocked(batchApplyNonInsertPendingRevisions).mock.calls[0]?.[1].map((item) => item.id)).toEqual([
      'u1',
      'u2',
      'u3',
      'd1',
      'u4',
    ])
    expect(applyDeletePendingRevision).not.toHaveBeenCalled()
    expect(batchApplyInsertPendingRevisions).not.toHaveBeenCalled()
    expect(result.successIds).toEqual(['u1', 'u2', 'u3', 'd1', 'u4'])
    expect(result.failedIds).toEqual([])
  })
})
