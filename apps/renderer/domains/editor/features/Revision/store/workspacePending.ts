/**
 * @file workspacePending.ts
 * @description Workspace pending revisions 的注入与会话生成（从 useRevisionStore.ts 拆出）。
 *
 * ✅ 当前策略：恢复旧的 mark 方案（真实节点 + revisionMark）
 * - 注入 pending 时，直接调用旧 applier，把 pending 变成 revisionMark（含表格/列表等块结构）。
 * - 不做整版回滚，只替换"pending 注入渲染"这条链路。
 *
 * ✅ 架构改进（canonical sessions）：
 * - 在 applier 执行前，先根据 DTO 全量快照构建 canonicalPendingSessions。
 * - 全局统计和文档级操作从 canonical sessions 派生，不受虚拟化影响。
 * - applier 完成后通过 startRevision 回填 diffStats 到 canonical session。
 *
 * ⚡ 性能优化（dispatch 批处理）：
 * - 注入 N 个 pending 会产生 N+ 次 editor.view.dispatch，每次都触发完整 DOM 协调
 * - 通过临时拦截 view.updateState，将中间态 DOM 协调全部跳过，最后一次性刷新
 * - appendTransaction 在 state.apply(tr) 内部执行，state 链条不受影响
 */

import type { Ref } from 'vue'
import type { Editor } from '@tiptap/core'
import type { PendingRevisionDTO as WorkspacePendingRevisionDTO } from '../../../../../shared/ipc/workspaceGateway'
import type { BlockRevisionState, StartRevisionParams, CanonicalPendingSession } from './types'
import { applyPendingRevisionsToEditor } from '../utils/pending/applyPendingRevisions'
import { findRootBlockPosById } from '../utils/pending/pendingRevisionHelpers'
import { parsePendingMeta } from '../utils/pending/pendingMeta'
import { citationRenderPluginKey } from '../../citation/render/citationRenderPlugin'
import { pendingListMayAffectCitationDerivation } from './workspacePendingCitation'
import { withBatchedPendingDispatches } from './pendingBatchDispatch'
import { mapWorkspacePendingToLegacy } from './pendingWorkspaceMapper'
import {
  createRevisionPendingPerfSession,
  measureRevisionPendingStage,
} from './revisionPendingPerf'
import { getFlag } from '../../../ui/services/editorFeatureFlags'
import {
  markCitationDerivationTransaction,
  markPendingRevisionProjectionTransaction,
} from '../../../core/transactions/editorTransactionMeta'

const LARGE_DOCUMENT_PENDING_PROJECTION_BLOCK_THRESHOLD = 1500
const LARGE_DOCUMENT_PENDING_PROJECTION_COUNT_THRESHOLD = 100

/**
 * 从 DTO 列表构建 canonical pending sessions（keyed by blockId）。
 *
 * 这一步在 applier 之前执行，保证全局统计在 mark 投影完成前就已正确。
 * diffStats 将在 applier 完成后由 startRevision 回填。
 */
function buildCanonicalSessions(
  pending: WorkspacePendingRevisionDTO[]
): Record<string, CanonicalPendingSession> {
  const sessions: Record<string, CanonicalPendingSession> = {}
  for (const dto of pending) {
    if (typeof dto.blockId !== 'string' || dto.blockId.length === 0) continue

    const meta = parsePendingMeta(typeof dto.metaJson === 'string' ? dto.metaJson : null, dto.operation)
    const operation = meta.operation ?? 'update'
    // revisionId 的格式需要与 applier 生成的一致（applier 用 `ai-${dto.id}`）
    const revisionId = `ai-${dto.id}`

    sessions[dto.blockId] = {
      pendingId: dto.id,
      blockId: dto.blockId,
      operation,
      revisionId,
      createdAt: typeof dto.createdAt === 'number' ? dto.createdAt : Date.now(),
      // diffStats 留空，等 applier 通过 startRevision 回填
    }
  }
  return sessions
}

export function setWorkspacePendingRevisionsImpl(params: {
  editor: Editor
  activeRevisions: Ref<Record<string, BlockRevisionState>>
  canonicalPendingSessions: Ref<Record<string, CanonicalPendingSession>>
  pending: WorkspacePendingRevisionDTO[]
  startRevision: (p: StartRevisionParams) => void
  /** 原始 DTO 缓存，供 undo 恢复后端同步用 */
  pendingDTOShadow?: Map<string, WorkspacePendingRevisionDTO>
}): void {
  const { editor, activeRevisions, canonicalPendingSessions, pending, pendingDTOShadow } = params

  const list = Array.isArray(pending) ? pending : []
  const perf = createRevisionPendingPerfSession(list.length)
  let successCount = 0
  let failedCount = 0
  let finishCalled = false
  const finishPerf = (error?: unknown) => {
    if (finishCalled) return
    finishCalled = true
    perf.finish({
      canonicalBlockCount: Object.keys(canonicalPendingSessions.value).length,
      activeRevisionCount: Object.keys(activeRevisions.value).length,
      successCount,
      failedCount,
      forceCitation: shouldForceCitationDerivation,
      error: error == null ? undefined : error instanceof Error ? error.message : String(error),
    })
  }
  const existingCitationState = citationRenderPluginKey.getState(editor.state)
  const shouldForceCitationDerivation =
    (existingCitationState?.derivation.instances.length ?? 0) > 0 ||
    pendingListMayAffectCitationDerivation(list)
  const shouldDeferProjection =
    getFlag('deferPendingProjectionForLargeDocuments') &&
    (editor.state.doc.childCount >= LARGE_DOCUMENT_PENDING_PROJECTION_BLOCK_THRESHOLD ||
      list.length >= LARGE_DOCUMENT_PENDING_PROJECTION_COUNT_THRESHOLD)

  // ---- 阶段 0：填充 shadow DTO cache（供 undo 后恢复后端同步） ----
  measureRevisionPendingStage(perf, 'shadow', () => {
    if (!pendingDTOShadow) return
    for (const dto of list) {
      if (typeof dto.blockId === 'string' && dto.blockId.length > 0) {
        pendingDTOShadow.set(dto.blockId, dto)
      }
    }
  })

  // ---- 阶段 1：立即构建 canonical sessions（全局统计从此刻起就是准确的） ----
  const nextCanonical = measureRevisionPendingStage(perf, 'canonical', () => {
    const canonical = buildCanonicalSessions(list)

    // 幂等比对：如果新旧 canonical 的 blockId 集合完全相同，保留旧的 diffStats
    const oldCanonical = canonicalPendingSessions.value
    for (const [blockId, session] of Object.entries(canonical)) {
      const old = oldCanonical[blockId]
      if (old && old.pendingId === session.pendingId && old.diffStats) {
        session.diffStats = old.diffStats
      }
    }
    return canonical
  })
  canonicalPendingSessions.value = nextCanonical

  // ---- 阶段 1：回收旧 pending 状态 ----
  const nextBlockIdSet = new Set(Object.keys(nextCanonical))

  const cleanupStaleActiveRevisions = () => {
    for (const blockId of Object.keys(activeRevisions.value)) {
      if (!nextBlockIdSet.has(blockId)) {
        delete activeRevisions.value[blockId]
      }
    }
  }

  if (shouldDeferProjection) {
    cleanupStaleActiveRevisions()
    perf.addStage('apply', 0)
    perf.addStage('flush', 0)
    console.info('[workspacePending] 大文档首开暂缓 pending revisionMark 投影', {
      rootBlockCount: editor.state.doc.childCount,
      pendingCount: list.length,
      canonicalBlockCount: Object.keys(nextCanonical).length,
    })
    successCount = 0
    failedCount = 0
    finishPerf()
    return
  }

  const cleanupAndApply = async () => {
    for (const [blockId, state] of Object.entries(activeRevisions.value)) {
      if (nextBlockIdSet.has(blockId)) continue

      // 仅对仍处于 pending 状态的 insert 块做物理删除
      if (state.operation === 'insert' && state.status === 'pending') {
        const blockPos = findRootBlockPosById(editor, blockId)
        if (blockPos != null) {
          const root = editor.state.doc.nodeAt(blockPos)
          if (root && root.type.name === 'rootBlock') {
            const tr = editor.state.tr.delete(blockPos, blockPos + root.nodeSize)
            markPendingRevisionProjectionTransaction(tr)
            editor.view.dispatch(tr)
          }
        }
      }

      delete activeRevisions.value[blockId]
    }

    // 清掉旧的 pending-xxx 会话（decorations 方案残留）
    for (const [blockId, state] of Object.entries(activeRevisions.value)) {
      if (state.revisionId.startsWith('pending-')) {
        delete activeRevisions.value[blockId]
      }
    }

    // ---- 阶段 2：应用新 pending revisions（mark 投影） ----
    const legacyDtos = list.map(mapWorkspacePendingToLegacy).map((dto) => {
      const meta = parsePendingMeta(dto.metaJson ?? null, dto.operation ?? undefined)
      return {
        ...dto,
        operation: meta.operation ?? dto.operation,
        metadata: undefined,
      }
    })

    const applyResult = await applyPendingRevisionsToEditor(editor, legacyDtos, {
      onStage(stage, durationMs) {
        perf.addStage(stage, durationMs)
      },
    })
    successCount = applyResult.successIds.length
    failedCount = applyResult.failedIds.length
  }

  void withBatchedPendingDispatches(editor, cleanupAndApply, {
    onFlush(durationMs) {
      perf.addStage('flush', durationMs)
    },
  }).then(() => {
    if (!shouldForceCitationDerivation) {
      finishPerf()
      return
    }

    // 触发一次空 transaction，以便让 citationRenderPlugin 等插件进行全量重算和 token 同步。
    // 无 citation 的普通 pending 文档跳过这一步，避免一次不必要的全文档派生。
    const citationStart =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now()
    const tr = editor.state.tr
    markCitationDerivationTransaction(tr)
    editor.view.dispatch(tr)
    const citationEnd =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now()
    perf.addStage('citation', citationEnd - citationStart)
    finishPerf()
  }).catch((error) => {
    finishPerf(error)
    console.error('[RevisionStore] setWorkspacePendingRevisions: pending 注入失败', error)
  })
}
