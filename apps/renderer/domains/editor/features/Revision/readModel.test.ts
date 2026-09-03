import { describe, expect, it } from 'vitest'
import { readRevisionIndicatorSummary } from './functions/readRevisionIndicatorSummary'
import type { CanonicalPendingSession } from './store/types'

function createCanonicalSession(
  overrides: Partial<CanonicalPendingSession> = {}
): CanonicalPendingSession {
  return {
    pendingId: 'pending-a',
    blockId: 'root-a',
    operation: 'update',
    revisionId: 'ai-pending-a',
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

describe('Revision readModel', () => {
  it('把 canonical pending 转成 Host revision indicator 摘要', () => {
    const summary = readRevisionIndicatorSummary(createCanonicalSession({
      diffStats: {
        insertCount: 3,
        deleteCount: 1,
      },
    }))

    expect(summary).toEqual({
      hasPendingRevision: true,
      status: 'pending',
      insertCount: 3,
      deleteCount: 1,
      createdAt: 1_700_000_000_000,
      forceVisible: true,
      pendingOnly: false,
    })
  })

  it('canonical 尚未回填 diffStats 时保持轻量待处理态', () => {
    const summary = readRevisionIndicatorSummary(createCanonicalSession())

    expect(summary).toEqual({
      hasPendingRevision: true,
      status: 'pending',
      insertCount: 0,
      deleteCount: 0,
      createdAt: 1_700_000_000_000,
      forceVisible: true,
      pendingOnly: true,
    })
  })

  it('没有 canonical pending 时返回空摘要', () => {
    expect(readRevisionIndicatorSummary(null)).toEqual({
      hasPendingRevision: false,
      status: 'pending',
      insertCount: 0,
      deleteCount: 0,
      forceVisible: false,
      pendingOnly: false,
    })
  })
})
