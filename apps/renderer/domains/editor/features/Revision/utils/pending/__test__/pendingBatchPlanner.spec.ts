import { describe, expect, it } from 'vitest'

import { planPendingExecutionBatches } from '../pendingBatchPlanner'

describe('pendingBatchPlanner', () => {
  it('chains insert anchorBlockId within the same anchor group and keeps non-insert as separate batch', () => {
    const batches = planPendingExecutionBatches([
      {
        id: 'u1',
        conversationId: 'conv',
        blockId: 'block-a',
        operation: 'update',
        originalMarkdown: '',
        newMarkdown: 'A1',
        metadata: { operation: 'update' },
        shouldRetry: false,
      },
      {
        id: 'i1',
        conversationId: 'conv',
        blockId: 'insert-1',
        operation: 'insert',
        originalMarkdown: '',
        newMarkdown: 'I1',
        metadata: { operation: 'insert', anchorBlockId: 'anchor-1' },
        createdAt: 10,
        shouldRetry: false,
      },
      {
        id: 'i2',
        conversationId: 'conv',
        blockId: 'insert-2',
        operation: 'insert',
        originalMarkdown: '',
        newMarkdown: 'I2',
        metadata: { operation: 'insert', anchorBlockId: 'anchor-1' },
        createdAt: 20,
        shouldRetry: false,
      },
    ])

    expect(batches).toHaveLength(2)
    expect(batches[0]).toMatchObject({
      kind: 'non-insert',
      revisions: [{ id: 'u1' }],
    })
    expect(batches[1]?.kind).toBe('insert')
    expect(batches[1]?.revisions.map((item) => item.id)).toEqual(['i1', 'i2'])
    expect(batches[1]?.revisions[0]?.metadata?.anchorBlockId).toBe('anchor-1')
    expect(batches[1]?.revisions[1]?.metadata?.anchorBlockId).toBe('insert-1')
  })
})
