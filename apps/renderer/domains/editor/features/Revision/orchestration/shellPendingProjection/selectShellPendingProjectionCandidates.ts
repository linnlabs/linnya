import { PERF_BLOCK_ID_SAMPLE_LIMIT, uniqueBlockIds } from './blockIdOrdering'

interface ShellPendingProjectionCandidateReader {
  hasCanonicalPending: (blockId: string) => boolean
  getRevisionState: (blockId: string) => { status?: string | null } | null
}

export interface ShellPendingProjectionCandidates {
  candidateBlockIds: string[]
  skippedActiveBlockIds: string[]
  skippedNonPendingBlockIds: string[]
  skippedActiveCount: number
  skippedNonPendingCount: number
}

export function selectShellPendingProjectionCandidates(
  store: ShellPendingProjectionCandidateReader,
  blockIds: readonly string[]
): ShellPendingProjectionCandidates {
  const candidateBlockIds: string[] = []
  const skippedActiveBlockIds: string[] = []
  const skippedNonPendingBlockIds: string[] = []
  let skippedActiveCount = 0
  let skippedNonPendingCount = 0

  for (const blockId of uniqueBlockIds(blockIds)) {
    if (!store.hasCanonicalPending(blockId)) {
      skippedNonPendingCount += 1
      if (skippedNonPendingBlockIds.length < PERF_BLOCK_ID_SAMPLE_LIMIT) {
        skippedNonPendingBlockIds.push(blockId)
      }
      continue
    }

    const activeRevision = store.getRevisionState(blockId)
    if (activeRevision?.status === 'pending') {
      skippedActiveCount += 1
      if (skippedActiveBlockIds.length < PERF_BLOCK_ID_SAMPLE_LIMIT) {
        skippedActiveBlockIds.push(blockId)
      }
      continue
    }

    candidateBlockIds.push(blockId)
  }

  return {
    candidateBlockIds,
    skippedActiveBlockIds,
    skippedNonPendingBlockIds,
    skippedActiveCount,
    skippedNonPendingCount,
  }
}
