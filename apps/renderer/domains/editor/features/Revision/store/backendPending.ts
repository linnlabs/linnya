/**
 * @file backendPending.ts
 * @description 与后端 Workspace pending revisions 读写/清理相关的 API。
 *
 * 核心原则：后端 pending_revisions 表是唯一事实源，
 * 前端所有对 pending 的增/删操作必须通过本模块走 IPC。
 */

import { workspaceGateway } from '../../../../../shared/ipc/workspaceGateway'
import type { PendingRevisionDTO } from '../../../../../shared/ipc/workspaceGateway'

export type FileStoreLike = {
  currentFilePath: string | null | undefined
}

export function createBackendPendingApi(fileStore: FileStoreLike) {
  /**
   * 获取当前文档的节点 ID（documentId）
   *
   * 约定：复用 fileStore.currentFilePath 作为文档节点 ID
   */
  function getCurrentDocumentId(): string | null {
    const documentId = fileStore.currentFilePath
    if (!documentId) {
      console.warn('[BackendPending] 当前没有活动文档，无法操作后端 pending revisions')
      return null
    }
    return documentId
  }

  // =========================================================================
  // 写入
  // =========================================================================

  /** 写入/覆盖指定块的 pending revision（upsert 语义） */
  async function setPendingRevisionInBackend(
    blockId: string,
    newMarkdown: string,
    source: 'ai' | 'user' | 'tool' = 'user',
    meta?: Record<string, unknown>,
  ): Promise<PendingRevisionDTO | null> {
    const documentId = getCurrentDocumentId()
    if (!documentId) return null

    try {
      const result = await workspaceGateway['set-pending-revision']({
        documentId, blockId, newMarkdown, source, meta,
      })
      if (!result.success) {
        console.warn('[BackendPending] set-pending-revision 失败:', { documentId, blockId, error: result.error })
        return null
      }
      return result.data
    } catch (error) {
      console.warn('[BackendPending] set-pending-revision 异常:', error)
      return null
    }
  }

  /**
   * 批量写入 pending revisions（同文档下多个块，一次 IPC 往返）
   *
   * 适用场景：测试工具批量注入、undo/redo 批量恢复
   */
  async function setPendingRevisionsBatchInBackend(
    revisions: Array<{
      blockId: string;
      newMarkdown: string;
      source?: 'ai' | 'user' | 'tool';
      meta?: Record<string, unknown>;
    }>,
  ): Promise<{ writtenCount: number; totalRequested: number; errors: string[] } | null> {
    const documentId = getCurrentDocumentId()
    if (!documentId) return null

    try {
      const result = await workspaceGateway['set-pending-revisions-batch']({
        documentId, revisions,
      })
      if (!result.success) {
        console.warn('[BackendPending] set-pending-revisions-batch 失败:', { documentId, error: result.error })
        return null
      }
      return result.data
    } catch (error) {
      console.warn('[BackendPending] set-pending-revisions-batch 异常:', error)
      return null
    }
  }

  // =========================================================================
  // 清理
  // =========================================================================

  /** 清理指定块的 pending revision 记录 */
  async function clearPendingRevisionInBackend(blockId: string): Promise<void> {
    const documentId = getCurrentDocumentId()
    if (!documentId) return

    try {
      const result = await workspaceGateway['clear-pending-revision']({ documentId, blockId })
      if (!result.success) {
        console.warn('[BackendPending] clear-pending-revision 失败:', { documentId, blockId, error: result.error })
      } else if (result.data.deletedCount === 0) {
        console.debug('[BackendPending] 后端无可删除的 pending revision:', { documentId, blockId })
      }
    } catch (error) {
      console.warn('[BackendPending] clear-pending-revision 异常:', error)
    }
  }

  /**
   * 后端原子应用指定块的 pending revision。
   *
   * 中文说明：
   * - 块级接受/拒绝不应每次保存整篇 10000 块文档；
   * - 这里复用后端 docJson apply 服务，只改当前 blockId 对应的 pending，并在同一事务里清理 pending；
   * - 返回 false 时调用方会回退到旧的“保存全文 + 清 pending”路径，保证可靠性优先。
   */
  async function applyPendingRevisionInBackend(
    blockId: string,
    mode: 'accept' | 'reject'
  ): Promise<boolean> {
    const documentId = getCurrentDocumentId()
    if (!documentId) return false

    try {
      const result = await workspaceGateway['apply-pending-revision']({ documentId, blockId, mode })
      if (!result.success) {
        console.warn('[BackendPending] apply-pending-revision 失败:', {
          documentId,
          blockId,
          mode,
          error: result.error,
        })
        return false
      }
      if (result.data.status !== 'ok') {
        console.warn('[BackendPending] apply-pending-revision 后端合并失败:', {
          documentId,
          blockId,
          mode,
          errors: result.data.errors,
        })
        return false
      }
      if (result.data.appliedCount <= 0) {
        console.warn('[BackendPending] apply-pending-revision 未应用任何 pending，回退全文保存路径:', {
          documentId,
          blockId,
          mode,
          skippedCount: result.data.skippedCount,
        })
        return false
      }
      return true
    } catch (error) {
      console.warn('[BackendPending] apply-pending-revision 异常:', error)
      return false
    }
  }

  /** 清理当前文档下所有 pending revision 记录 */
  async function clearAllPendingRevisionsInBackend(): Promise<void> {
    const documentId = getCurrentDocumentId()
    if (!documentId) return

    try {
      const result = await workspaceGateway['clear-all-pending-revisions']({ documentId })
      if (!result.success) {
        console.warn('[BackendPending] clear-all-pending-revisions 失败:', { documentId, error: result.error })
      } else {
        console.debug('[BackendPending] 文档级 pending revisions 已清理:', { documentId, deletedCount: result.data.deletedCount })
      }
    } catch (error) {
      console.warn('[BackendPending] clear-all-pending-revisions 异常:', error)
    }
  }

  // =========================================================================
  // 读取（刷新）
  // =========================================================================

  /**
   * 从后端重新读取文档并返回最新的 pendingRevisions DTO 列表。
   * 用于"写入后端 → 重新注入前端"的完整流程。
   */
  async function readPendingRevisionsFromBackend(): Promise<PendingRevisionDTO[] | null> {
    const documentId = getCurrentDocumentId()
    if (!documentId) return null

    try {
      const result = await workspaceGateway['read-document']({ documentId })
      if (!result.success) {
        console.warn('[BackendPending] read-document 失败:', { documentId, error: result.error })
        return null
      }
      return result.data.pendingRevisions ?? []
    } catch (error) {
      console.warn('[BackendPending] read-document 异常:', error)
      return null
    }
  }

  return {
    getCurrentDocumentId,
    // 写入
    setPendingRevisionInBackend,
    setPendingRevisionsBatchInBackend,
    // 清理
    clearPendingRevisionInBackend,
    applyPendingRevisionInBackend,
    clearAllPendingRevisionsInBackend,
    // 读取
    readPendingRevisionsFromBackend,
  }
}
