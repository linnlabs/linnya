import type { Editor } from '@tiptap/core'
import type { ApplyDetail, ParsedPendingRevision, PendingRevisionOperation } from './pendingRevisionTypes'
import type { PendingExecutionPlan } from './pendingExecutionPlan'
import { useRevisionStore } from '../../store/useRevisionStore'

export interface RegisterablePreparedRevision {
  parsed: ParsedPendingRevision
  blockId: string
  revisionId: string
  operation: Exclude<PendingRevisionOperation, 'insert'>
  plan: PendingExecutionPlan
  appliedDiffStats?: { insertCount: number; deleteCount: number }
  successReason?: string
  error?: string
}

export function registerPreparedRevisions(
  editor: Editor,
  prepared: RegisterablePreparedRevision[],
  results: ApplyDetail[]
): void {
  for (const item of prepared) {
    const matchingResult = results.find((detail) => detail.id === item.parsed.id)
    if (!matchingResult?.success || !item.appliedDiffStats) continue
    if (item.appliedDiffStats.insertCount === 0 && item.appliedDiffStats.deleteCount === 0) continue

    try {
      const revisionStore = useRevisionStore(editor)
      revisionStore.startRevision({
        blockId: item.blockId,
        revisionId: item.revisionId,
        operation: item.operation,
        diffStats: item.appliedDiffStats,
        createdAt: typeof item.parsed.createdAt === 'number' ? item.parsed.createdAt : undefined,
      })
    } catch (e) {
      console.warn('[batchApplyUpdatePendingRevisions] 注册 RevisionStore 失败:', e)
    }
  }
}

export function pushMissingBlockWarning(
  missingBlockCount: number,
  missingBlockSamples: string[],
  total: number
): void {
  if (missingBlockCount <= 0) return

  console.warn('[batchApplyUpdatePendingRevisions] 跳过幽灵 pending revisions', {
    missingBlockCount,
    samples: missingBlockSamples,
    total,
  })
}

export function createExecutionHistoryBlockId(
  item: RegisterablePreparedRevision
): string | undefined {
  return item.plan.kind === 'table-update-with-history'
    ? `history-${item.blockId}-${item.parsed.id}`
    : undefined
}

export function pushFailedExecutionResult(
  results: ApplyDetail[],
  item: RegisterablePreparedRevision,
  reason: string
): void {
  results.push({
    id: item.parsed.id,
    success: false,
    operation: item.operation,
    blockId: item.blockId,
    reason,
  })
}

export function pushSuccessfulExecutionResult(
  results: ApplyDetail[],
  item: RegisterablePreparedRevision,
  reason: string | undefined
): void {
  results.push({
    id: item.parsed.id,
    success: true,
    operation: item.operation,
    blockId: item.blockId,
    reason,
  })
}
