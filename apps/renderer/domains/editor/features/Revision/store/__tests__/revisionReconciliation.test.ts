import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import type { PendingRevisionDTO as WorkspacePendingRevisionDTO } from '../../../../../../shared/ipc/workspaceGateway'
import type { BlockRevisionState, CanonicalPendingSession } from '../types'
import { createRevisionReconciliation } from '../revisionReconciliation'
import { scanBlockForRevisions, type RevisionMarkScanResult } from '../revisionMarkScan'

vi.mock('../revisionMarkScan', () => ({
  scanBlockForRevisions: vi.fn(),
}))

interface FakeRootBlock {
  type: { name: 'rootBlock' }
  attrs: { id: string }
  nodeSize: number
}

function createRootBlock(blockId: string): FakeRootBlock {
  return {
    type: { name: 'rootBlock' },
    attrs: { id: blockId },
    nodeSize: 1,
  }
}

function createDoc(blockIds: string[]): ProseMirrorNode {
  const blocks = blockIds.map(createRootBlock)
  return {
    childCount: blocks.length,
    child: (index: number) => blocks[index],
  } as unknown as ProseMirrorNode
}

function createEditor(blockIds: string[]): Editor & { _isPendingRevisionBatch?: boolean } {
  return {
    _isPendingRevisionBatch: false,
    state: {
      doc: createDoc(blockIds),
    },
    on: vi.fn(),
  } as unknown as Editor & { _isPendingRevisionBatch?: boolean }
}

function createCanonical(blockId: string, pendingId = blockId): CanonicalPendingSession {
  return {
    pendingId,
    blockId,
    operation: 'update',
    revisionId: `ai-${pendingId}`,
    createdAt: 1,
  }
}

function createActive(blockId: string, revisionId: string): BlockRevisionState {
  return {
    blockId,
    revisionId,
    status: 'pending',
    operation: 'update',
    createdAt: 1,
  }
}

function createController(params: {
  editor: Editor & { _isPendingRevisionBatch?: boolean }
  canonical: Record<string, CanonicalPendingSession>
  active?: Record<string, BlockRevisionState>
  shadow?: Map<string, WorkspacePendingRevisionDTO>
}) {
  const canonicalPendingSessions = ref(params.canonical)
  const activeRevisions = ref(params.active ?? {})
  const clearPendingRevisionInBackend = vi.fn(async () => undefined)
  const setPendingRevisionsBatchInBackend = vi.fn(async () => ({
    writtenCount: 0,
    totalRequested: 0,
    errors: [],
  }))

  const controller = createRevisionReconciliation({
    editor: params.editor,
    canonicalPendingSessions,
    activeRevisions,
    pendingDTOShadow: params.shadow ?? new Map(),
    hasCanonicalPending: (blockId) => blockId in canonicalPendingSessions.value,
    clearPendingRevisionInBackend,
    setPendingRevisionsBatchInBackend,
  })

  return {
    controller,
    canonicalPendingSessions,
    activeRevisions,
    clearPendingRevisionInBackend,
  }
}

describe('revisionReconciliation', () => {
  beforeEach(() => {
    vi.mocked(scanBlockForRevisions).mockReset()
    vi.mocked(scanBlockForRevisions).mockReturnValue(null)
  })

  it('keeps canonical-only pending sessions when lazy projection has not created marks yet', () => {
    const editor = createEditor(['block-a', 'block-b'])
    const { controller, canonicalPendingSessions, clearPendingRevisionInBackend } = createController({
      editor,
      canonical: {
        'block-a': createCanonical('block-a'),
        'block-b': createCanonical('block-b'),
      },
    })

    controller.reconcileCanonicalWithDocument()

    expect(Object.keys(canonicalPendingSessions.value)).toEqual(['block-a', 'block-b'])
    expect(clearPendingRevisionInBackend).not.toHaveBeenCalled()
  })

  it('clears only projected canonical sessions whose matching revision mark disappeared', () => {
    const editor = createEditor(['block-a', 'block-b'])
    const { controller, canonicalPendingSessions, clearPendingRevisionInBackend } = createController({
      editor,
      canonical: {
        'block-a': createCanonical('block-a'),
        'block-b': createCanonical('block-b'),
      },
      active: {
        'block-b': createActive('block-b', 'ai-block-b'),
      },
    })

    controller.reconcileCanonicalWithDocument()

    expect(Object.keys(canonicalPendingSessions.value)).toEqual(['block-a'])
    expect(clearPendingRevisionInBackend).toHaveBeenCalledTimes(1)
    expect(clearPendingRevisionInBackend).toHaveBeenCalledWith('block-b')
  })

  it('does not let a stale active revision clear a newer canonical session for the same block', () => {
    const editor = createEditor(['block-a'])
    const { controller, canonicalPendingSessions, clearPendingRevisionInBackend } = createController({
      editor,
      canonical: {
        'block-a': createCanonical('block-a', 'new-pending'),
      },
      active: {
        'block-a': createActive('block-a', 'ai-old-pending'),
      },
    })

    controller.reconcileCanonicalWithDocument()

    expect(Object.keys(canonicalPendingSessions.value)).toEqual(['block-a'])
    expect(clearPendingRevisionInBackend).not.toHaveBeenCalled()
  })

  it('still restores canonical sessions from orphan marks when the DTO shadow exists', () => {
    const editor = createEditor(['block-a'])
    const mark: RevisionMarkScanResult = {
      revisionId: 'ai-pending-a',
      diffStats: { insertCount: 1, deleteCount: 0 },
    }
    vi.mocked(scanBlockForRevisions).mockReturnValue(mark)

    const { controller, canonicalPendingSessions } = createController({
      editor,
      canonical: {},
      shadow: new Map([
        ['block-a', {
          id: 'pending-a',
          blockId: 'block-a',
          operation: 'update',
          newMarkdown: 'new content',
          source: 'ai',
          metaJson: JSON.stringify({ operation: 'update' }),
          createdAt: 2,
          updatedAt: null,
        }],
      ]),
    })

    controller.reconcileCanonicalWithDocument()

    expect(canonicalPendingSessions.value['block-a']).toMatchObject({
      pendingId: 'pending-a',
      blockId: 'block-a',
      revisionId: 'ai-pending-a',
      diffStats: { insertCount: 1, deleteCount: 0 },
    })
  })
})
