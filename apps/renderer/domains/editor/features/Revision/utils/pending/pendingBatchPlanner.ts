import type { ParsedPendingRevision } from './pendingRevisionTypes'

export interface PendingExecutionBatch {
  kind: 'non-insert' | 'insert'
  revisions: ParsedPendingRevision[]
}

export function planPendingExecutionBatches(
  revisions: ParsedPendingRevision[]
): PendingExecutionBatch[] {
  const batches: PendingExecutionBatch[] = []
  let pendingNonInsert: ParsedPendingRevision[] = []
  const groupedInserts = new Map<string, ParsedPendingRevision[]>()

  const flushNonInsert = () => {
    if (pendingNonInsert.length === 0) return
    batches.push({
      kind: 'non-insert',
      revisions: pendingNonInsert,
    })
    pendingNonInsert = []
  }

  for (const parsed of revisions) {
    const operation = (parsed.metadata?.operation as string) || 'update'
    const anchorBlockId = parsed.metadata?.anchorBlockId as string | undefined

    if (operation === 'insert' && anchorBlockId) {
      flushNonInsert()
      const group = groupedInserts.get(anchorBlockId) ?? []
      group.push(parsed)
      groupedInserts.set(anchorBlockId, group)
      continue
    }

    pendingNonInsert.push(parsed)
  }

  flushNonInsert()

  const orderedInserts: ParsedPendingRevision[] = []
  for (const [, group] of groupedInserts.entries()) {
    group.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    let lastInsertedBlockId: string | null = null

    for (const parsed of group) {
      if (lastInsertedBlockId && parsed.metadata) {
        parsed.metadata.anchorBlockId = lastInsertedBlockId
      }
      orderedInserts.push(parsed)
      lastInsertedBlockId = parsed.blockId
    }
  }

  if (orderedInserts.length > 0) {
    batches.push({
      kind: 'insert',
      revisions: orderedInserts,
    })
  }

  return batches
}
