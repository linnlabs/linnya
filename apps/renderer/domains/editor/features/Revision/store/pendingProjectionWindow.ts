import type { Ref } from 'vue'
import type { Editor } from '@tiptap/core'
import type { PendingRevisionDTO as WorkspacePendingRevisionDTO } from '../../../../../shared/ipc/workspaceGateway'
import type { BlockRevisionState, CanonicalPendingSession, PendingProjectionResult } from './types'
import { applyPendingRevisionsToEditor } from '../utils/pending/applyPendingRevisions'
import { parsePendingMeta } from '../utils/pending/pendingMeta'
import { pendingListMayAffectCitationDerivation } from './workspacePendingCitation'
import { withBatchedPendingDispatches } from './pendingBatchDispatch'
import { mapWorkspacePendingToLegacy } from './pendingWorkspaceMapper'
import { shouldLogRevisionDebug } from '../utils/revisionDebugLogging'
import { markCitationDerivationTransaction } from '../../../core/transactions/editorTransactionMeta'

export interface PendingProjectionWindowParams {
  editor: Editor
  blockIds: string[]
  canonicalPendingSessions: Ref<Record<string, CanonicalPendingSession>>
  activeRevisions: Ref<Record<string, BlockRevisionState>>
  pendingDTOShadow: Map<string, WorkspacePendingRevisionDTO>
  projectingBlockIds: Set<string>
  maxBatchSize?: number
}

export type PendingProjectionWindowResult = PendingProjectionResult

const DEFAULT_MAX_BATCH_SIZE = 20

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

function uniqStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (typeof value !== 'string' || value.length === 0 || seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

function shouldLogProjection(result: PendingProjectionWindowResult): boolean {
  return shouldLogRevisionDebug() || result.failedCount > 0
}

function normalizeWorkspacePending(dto: WorkspacePendingRevisionDTO) {
  const legacy = mapWorkspacePendingToLegacy(dto)
  const meta = parsePendingMeta(legacy.metaJson ?? null, legacy.operation ?? undefined)
  return {
    ...legacy,
    operation: meta.operation ?? legacy.operation,
    metadata: undefined,
  }
}

export async function projectPendingRevisionsForBlocks(
  params: PendingProjectionWindowParams
): Promise<PendingProjectionWindowResult> {
  const startedAt = nowMs()
  const requestedBlockIds = uniqStrings(params.blockIds)
  const maxBatchSize = Math.max(1, params.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE)
  const selectedBlockIds: string[] = []
  let skippedCount = 0

  for (const blockId of requestedBlockIds) {
    if (selectedBlockIds.length >= maxBatchSize) {
      skippedCount += 1
      continue
    }
    if (params.projectingBlockIds.has(blockId)) {
      skippedCount += 1
      continue
    }
    if (params.activeRevisions.value[blockId]) {
      skippedCount += 1
      continue
    }
    if (!params.canonicalPendingSessions.value[blockId]) {
      skippedCount += 1
      continue
    }
    if (!params.pendingDTOShadow.has(blockId)) {
      skippedCount += 1
      continue
    }
    selectedBlockIds.push(blockId)
  }

  if (selectedBlockIds.length === 0) {
    return {
      requestedCount: requestedBlockIds.length,
      batchCount: 0,
      projectedCount: 0,
      skippedCount,
      failedCount: 0,
      totalMs: Math.round((nowMs() - startedAt) * 10) / 10,
      flushMs: 0,
    }
  }

  for (const blockId of selectedBlockIds) {
    params.projectingBlockIds.add(blockId)
  }

  let flushMs = 0
  let projectedCount = 0
  let failedCount = 0

  try {
    const workspaceDtos = selectedBlockIds
      .map((blockId) => params.pendingDTOShadow.get(blockId))
      .filter((dto): dto is WorkspacePendingRevisionDTO => dto != null)
    const legacyDtos = workspaceDtos.map(normalizeWorkspacePending)

    await withBatchedPendingDispatches(params.editor, async () => {
      const result = await applyPendingRevisionsToEditor(params.editor, legacyDtos)
      projectedCount = result.successIds.length
      failedCount = result.failedIds.length
    }, {
      onFlush(durationMs) {
        flushMs += durationMs
      },
    })

    if (pendingListMayAffectCitationDerivation(workspaceDtos)) {
      const tr = params.editor.state.tr
      markCitationDerivationTransaction(tr)
      params.editor.view.dispatch(tr)
    }
  } finally {
    for (const blockId of selectedBlockIds) {
      params.projectingBlockIds.delete(blockId)
    }
  }

  const result: PendingProjectionWindowResult = {
    requestedCount: requestedBlockIds.length,
    batchCount: selectedBlockIds.length,
    projectedCount,
    skippedCount,
    failedCount,
    totalMs: Math.round((nowMs() - startedAt) * 10) / 10,
    flushMs: Math.round(flushMs * 10) / 10,
  }

  if (shouldLogProjection(result)) {
    console.info('[RevisionPerf] pending 投影窗口', result)
  }

  return result
}
