/**
 * revisionReconciliation.ts
 *
 * Revision canonical 与文档 revisionMark 的 Undo/Redo 对账模块。
 *
 * 中文说明：
 * - useRevisionStore 是业务编排层，不应该直接持有 debounce timer 和后端恢复队列；
 * - 本模块专门处理“文档 mark 变化后，canonical / 后端 pending 是否需要恢复或清理”；
 * - 全局 pending 事实源仍是 canonicalPendingSessions，mark 扫描只用于撤销/重做后的对账。
 */

import type { Ref } from 'vue'
import type { Editor } from '@tiptap/core'
import type { PendingRevisionDTO as WorkspacePendingRevisionDTO } from '../../../../../shared/ipc/workspaceGateway'
import type { BlockRevisionState, CanonicalPendingSession } from './types'
import { parsePendingMeta } from '../utils/pending/pendingMeta'
import { scanBlockForRevisions } from './revisionMarkScan'

interface RevisionReconciliationEditor extends Editor {
  _isPendingRevisionBatch?: boolean
}

interface PendingBackendWrite {
  blockId: string
  newMarkdown: string
  source?: 'ai' | 'user' | 'tool'
  meta?: Record<string, unknown>
}

export interface RevisionReconciliationOptions {
  editor: RevisionReconciliationEditor
  canonicalPendingSessions: Ref<Record<string, CanonicalPendingSession>>
  activeRevisions: Ref<Record<string, BlockRevisionState>>
  pendingDTOShadow: Map<string, WorkspacePendingRevisionDTO>
  hasCanonicalPending: (blockId: string) => boolean
  clearPendingRevisionInBackend: (blockId: string) => Promise<void>
  setPendingRevisionsBatchInBackend: (
    revisions: PendingBackendWrite[]
  ) => Promise<{ writtenCount: number; totalRequested: number; errors: string[] } | null>
}

export interface RevisionReconciliationController {
  registerTransactionListener: () => void
  reconcileCanonicalWithDocument: () => void
  markBackendWritePending: (blockId: string) => void
  deleteBackendWritePending: (blockId: string) => void
  scheduleBackendSync: () => void
  clear: () => void
}

function parseMetaJson(metaJson: string | null): Record<string, unknown> | undefined {
  if (!metaJson) return undefined

  try {
    const parsed = JSON.parse(metaJson) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch (error) {
    console.warn('[RevisionReconciliation] 解析 pending metaJson 失败，跳过 meta 写回:', error)
  }

  return undefined
}

function createBackendWriteFromDTO(dto: WorkspacePendingRevisionDTO): PendingBackendWrite {
  return {
    blockId: dto.blockId,
    newMarkdown: dto.newMarkdown,
    source: dto.source,
    meta: parseMetaJson(dto.metaJson),
  }
}

export function createRevisionReconciliation(
  options: RevisionReconciliationOptions
): RevisionReconciliationController {
  const pendingBackendWriteQueue = new Set<string>()
  let backendSyncTimer: ReturnType<typeof setTimeout> | null = null
  let reconcileTimer: ReturnType<typeof setTimeout> | null = null

  async function flushBackendWriteQueue(): Promise<void> {
    if (pendingBackendWriteQueue.size === 0) return
    const blockIds = [...pendingBackendWriteQueue]
    pendingBackendWriteQueue.clear()

    const revisions = blockIds
      .map((blockId) => {
        const dto = options.pendingDTOShadow.get(blockId)
        return dto ? createBackendWriteFromDTO(dto) : null
      })
      .filter((revision): revision is PendingBackendWrite => revision !== null)

    if (revisions.length > 0) {
      console.log(`[RevisionStore] flushBackendWriteQueue: 写回 ${revisions.length} 个 undo 恢复的 pending`)
      await options.setPendingRevisionsBatchInBackend(revisions)
    }
  }

  function scheduleBackendSync(): void {
    if (backendSyncTimer) clearTimeout(backendSyncTimer)
    backendSyncTimer = setTimeout(() => {
      backendSyncTimer = null
      void flushBackendWriteQueue()
    }, 300)
  }

  function reconcileCanonicalWithDocument(): void {
    if (options.editor._isPendingRevisionBatch) return

    const { doc } = options.editor.state
    const blocksWithMarks = new Map<string, {
      pos: number
      revisionId: string
      diffStats: { insertCount: number; deleteCount: number }
    }>()

    let pos = 0
    for (let index = 0; index < doc.childCount; index += 1) {
      const node = doc.child(index)
      const blockId = typeof node.attrs.id === 'string' ? node.attrs.id : null
      if (node.type.name === 'rootBlock' && blockId) {
        const scan = scanBlockForRevisions(options.editor, pos)
        if (scan) {
          blocksWithMarks.set(blockId, {
            pos,
            revisionId: scan.revisionId,
            diffStats: scan.diffStats,
          })
        }
      }
      pos += node.nodeSize
    }

    let restoredCount = 0
    let clearedCount = 0

    // 有 marks 但无 canonical：通常来自 undo 恢复 pending 投影。
    for (const [blockId, info] of blocksWithMarks) {
      if (!options.hasCanonicalPending(blockId)) {
        const shadowDTO = options.pendingDTOShadow.get(blockId)
        if (shadowDTO) {
          const meta = parsePendingMeta(
            typeof shadowDTO.metaJson === 'string' ? shadowDTO.metaJson : null,
            shadowDTO.operation
          )
          options.canonicalPendingSessions.value[blockId] = {
            pendingId: shadowDTO.id,
            blockId,
            operation: meta.operation ?? 'update',
            revisionId: info.revisionId,
            createdAt: typeof shadowDTO.createdAt === 'number' ? shadowDTO.createdAt : Date.now(),
            diffStats: info.diffStats,
          }
          pendingBackendWriteQueue.add(blockId)
          restoredCount += 1
        }
      }
    }

    // 有 canonical 但无 marks：只有“已经投影过”的块才允许清理。
    // 中文说明：
    // - 大文档懒投影后，canonical-only pending 块本来就没有 revisionMark；
    // - 如果这里继续按旧逻辑全文档清理，会把离屏 pending 误判成“已应用”；
    // - activeRevisions 是 mark 投影层，只有同一个 revisionId 进入过该层，mark 消失才代表 redo/手动清除。
    for (const blockId of Object.keys(options.canonicalPendingSessions.value)) {
      const canonicalSession = options.canonicalPendingSessions.value[blockId]
      const activeRevision = options.activeRevisions.value[blockId]
      const shouldClearCanonical =
        activeRevision != null &&
        canonicalSession != null &&
        activeRevision.revisionId === canonicalSession.revisionId &&
        !blocksWithMarks.has(blockId)

      if (shouldClearCanonical) {
        delete options.canonicalPendingSessions.value[blockId]
        pendingBackendWriteQueue.delete(blockId)
        void options.clearPendingRevisionInBackend(blockId)
        clearedCount += 1
      }
    }

    if (restoredCount > 0 || clearedCount > 0) {
      options.canonicalPendingSessions.value = { ...options.canonicalPendingSessions.value }
      console.log(`[RevisionStore] reconcile: 恢复 ${restoredCount} 个, 清理 ${clearedCount} 个 canonical sessions`)
      if (restoredCount > 0) {
        scheduleBackendSync()
      }
    }
  }

  function registerTransactionListener(): void {
    options.editor.on('transaction', ({ transaction }) => {
      if (!transaction.docChanged) return
      if (options.editor._isPendingRevisionBatch || transaction.getMeta('pendingRevisionApply')) return
      if (options.pendingDTOShadow.size === 0) return
      if (reconcileTimer) clearTimeout(reconcileTimer)
      reconcileTimer = setTimeout(() => {
        reconcileTimer = null
        reconcileCanonicalWithDocument()
      }, 500)
    })
  }

  function clear(): void {
    pendingBackendWriteQueue.clear()
    if (backendSyncTimer) {
      clearTimeout(backendSyncTimer)
      backendSyncTimer = null
    }
    if (reconcileTimer) {
      clearTimeout(reconcileTimer)
      reconcileTimer = null
    }
  }

  return {
    registerTransactionListener,
    reconcileCanonicalWithDocument,
    markBackendWritePending: (blockId) => pendingBackendWriteQueue.add(blockId),
    deleteBackendWritePending: (blockId) => pendingBackendWriteQueue.delete(blockId),
    scheduleBackendSync,
    clear,
  }
}
