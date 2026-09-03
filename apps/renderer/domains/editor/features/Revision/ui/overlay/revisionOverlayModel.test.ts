import { describe, expect, it } from 'vitest'
import type { CanonicalPendingSession } from '../../store/types'
import { buildRevisionOverlayItems } from './revisionOverlayModel'
import type { RevisionOverlayCanonicalReader, RevisionOverlayRootBlockSnapshot } from './revisionOverlayTypes'

function createReader(sessions: Record<string, CanonicalPendingSession>): RevisionOverlayCanonicalReader {
  return {
    getCanonicalSession: (blockId) => sessions[blockId] ?? null,
  }
}

function block(
  blockId: string,
  patch: Partial<RevisionOverlayRootBlockSnapshot> = {}
): RevisionOverlayRootBlockSnapshot {
  return {
    blockId,
    top: 0,
    left: 0,
    width: 100,
    height: 24,
    bottom: 24,
    isPlaceholder: false,
    renderMode: 'hydrated',
    ...patch,
  }
}

describe('revisionOverlayModel', () => {
  it('shows canonical-only pending as a lightweight block state before inline diff projection', () => {
    const items = buildRevisionOverlayItems({
      blocks: [block('b1'), block('b2')],
      reader: createReader({
        b1: {
          pendingId: 'p1',
          blockId: 'b1',
          operation: 'update',
          revisionId: 'ai-p1',
          createdAt: 10,
        },
      }),
      hoveredBlockId: null,
      toolbarHoverBlockId: null,
      selectionBlockId: null,
    })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      blockId: 'b1',
      insertCount: 0,
      deleteCount: 0,
      forceIndicatorVisible: true,
      hasDetailedStats: false,
      showToolbar: false,
    })
  })

  it('opens the toolbar for hovered canonical pending blocks', () => {
    const items = buildRevisionOverlayItems({
      blocks: [block('b1')],
      reader: createReader({
        b1: {
          pendingId: 'p1',
          blockId: 'b1',
          operation: 'update',
          revisionId: 'ai-p1',
          createdAt: 10,
          diffStats: { insertCount: 3, deleteCount: 1 },
        },
      }),
      hoveredBlockId: 'b1',
      toolbarHoverBlockId: null,
      selectionBlockId: null,
    })

    expect(items[0]).toMatchObject({
      insertCount: 3,
      deleteCount: 1,
      hasDetailedStats: true,
      showToolbar: true,
    })
  })

})
