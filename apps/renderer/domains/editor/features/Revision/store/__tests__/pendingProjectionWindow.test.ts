import { ref } from 'vue'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Editor } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'
import type { PendingRevisionDTO as WorkspacePendingRevisionDTO } from '../../../../../../shared/ipc/workspaceGateway'
import type { BlockRevisionState, CanonicalPendingSession } from '../types'
import { projectPendingRevisionsForBlocks } from '../pendingProjectionWindow'
import { applyPendingRevisionsToEditor } from '../../utils/pending/applyPendingRevisions'
import { EDITOR_EPHEMERAL_TRANSACTION_META } from '../../../../core/transactions/editorTransactionMeta'

vi.mock('../../utils/pending/applyPendingRevisions', () => ({
  applyPendingRevisionsToEditor: vi.fn(),
}))

function createEditor(): Editor {
  const trMeta = new Map<string, unknown>()
  const tr = {
    setMeta(key: string, value: unknown) {
      trMeta.set(key, value)
      return tr
    },
    getMeta(key: string) {
      return trMeta.get(key)
    },
  }
  const state = {} as EditorState
  return {
    state: {
      ...state,
      tr,
    },
    view: {
      dispatch: vi.fn(),
      updateState: vi.fn(),
      _state: state,
      _props: { state },
    },
  } as unknown as Editor
}

function createDto(blockId: string, id = blockId): WorkspacePendingRevisionDTO {
  return {
    id,
    blockId,
    operation: 'update',
    newMarkdown: `new ${blockId}`,
    source: 'ai',
    metaJson: JSON.stringify({ operation: 'update' }),
    createdAt: 1,
    updatedAt: null,
  }
}

function createCanonical(blockId: string): CanonicalPendingSession {
  return {
    pendingId: blockId,
    blockId,
    operation: 'update',
    revisionId: `ai-${blockId}`,
    createdAt: 1,
  }
}

describe('pendingProjectionWindow', () => {
  beforeEach(() => {
    vi.mocked(applyPendingRevisionsToEditor).mockReset()
    vi.mocked(applyPendingRevisionsToEditor).mockResolvedValue({
      successIds: ['a'],
      failedIds: [],
      details: [],
    })
  })

  it('projects only canonical-only pending blocks in the requested window', async () => {
    const editor = createEditor()
    const canonicalPendingSessions = ref<Record<string, CanonicalPendingSession>>({
      a: createCanonical('a'),
      b: createCanonical('b'),
      c: createCanonical('c'),
    })
    const activeRevisions = ref<Record<string, BlockRevisionState>>({
      b: {
        blockId: 'b',
        revisionId: 'ai-b',
        status: 'pending',
        createdAt: 1,
      },
    })
    const pendingDTOShadow = new Map<string, WorkspacePendingRevisionDTO>([
      ['a', createDto('a')],
      ['b', createDto('b')],
      ['c', createDto('c')],
    ])

    const result = await projectPendingRevisionsForBlocks({
      editor,
      blockIds: ['a', 'b', 'missing', 'a', 'c'],
      canonicalPendingSessions,
      activeRevisions,
      pendingDTOShadow,
      projectingBlockIds: new Set(['c']),
      maxBatchSize: 20,
    })

    expect(result.requestedCount).toBe(4)
    expect(result.batchCount).toBe(1)
    expect(result.projectedCount).toBe(1)
    expect(result.skippedCount).toBe(3)
    expect(applyPendingRevisionsToEditor).toHaveBeenCalledTimes(1)
    expect(vi.mocked(applyPendingRevisionsToEditor).mock.calls[0]?.[1]).toMatchObject([
      { id: 'a', blockId: 'a', newMarkdown: 'new a' },
    ])
  })

  it('marks citation derivation after projection as non-history', async () => {
    const editor = createEditor()
    const canonicalPendingSessions = ref<Record<string, CanonicalPendingSession>>({
      a: createCanonical('a'),
    })
    const activeRevisions = ref<Record<string, BlockRevisionState>>({})
    const pendingDTOShadow = new Map<string, WorkspacePendingRevisionDTO>([
      ['a', { ...createDto('a'), newMarkdown: 'new [@ref]' }],
    ])

    await projectPendingRevisionsForBlocks({
      editor,
      blockIds: ['a'],
      canonicalPendingSessions,
      activeRevisions,
      pendingDTOShadow,
      projectingBlockIds: new Set(),
      maxBatchSize: 20,
    })

    expect(editor.view.dispatch).toHaveBeenCalledTimes(1)
    const dispatchedTr = vi.mocked(editor.view.dispatch).mock.calls[0]?.[0]
    expect(dispatchedTr?.getMeta('forceCitationDerivation')).toBe(true)
    expect(dispatchedTr?.getMeta('addToHistory')).toBe(false)
    expect(dispatchedTr?.getMeta(EDITOR_EPHEMERAL_TRANSACTION_META)).toBe('citation-derivation')
  })
})
