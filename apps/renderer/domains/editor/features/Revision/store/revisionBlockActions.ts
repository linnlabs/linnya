/**
 * revisionBlockActions.ts
 *
 * 块级修订操作事务。
 *
 * 中文说明：
 * - 这里负责真正修改 ProseMirror 文档、保存、清理后端 pending；
 * - useRevisionStore 只提供状态容器与对外 API，不再承载所有命令细节；
 * - canonical 仍是 pending 事实源，activeRevisions 只是已投影窗口。
 */

import type { Ref } from 'vue'
import type { Editor } from '@tiptap/core'
import type { RevisionChangeType } from '../../../extensions/revision/RevisionMark'
import type {
  BlockRevisionActionOptions,
  BlockRevisionState,
  CanonicalPendingSession,
  PendingProjectionResult,
} from './types'
import { findRootBlockPosById } from '../utils/pending/pendingRevisionHelpers'
import { hasRevisionMarksInBlock } from './revisionMarkScan'
import { resolvePendingBlockRevisionForAction } from './blockRevisionActionResolver'
import {
  createRevisionActionPerfSession,
  type RevisionActionPerfSession,
  type RevisionActionPath,
} from './revisionActionPerf'

interface RevisionActionEditor extends Editor {
  commands: Editor['commands'] & {
    acceptAllRevisionsInBlock: (blockPos: number, revisionId: string) => boolean
    rejectAllRevisionsInBlock: (blockPos: number, revisionId: string) => boolean
  }
}

export interface RevisionBlockActionsOptions {
  editor: RevisionActionEditor
  activeRevisions: Ref<Record<string, BlockRevisionState>>
  canonicalPendingSessions: Ref<Record<string, CanonicalPendingSession>>
  hasCanonicalPending: (blockId: string) => boolean
  projectPendingRevisionsForBlocks: (blockIds: string[]) => Promise<PendingProjectionResult>
  getRevisionState: (blockId: string) => BlockRevisionState | null
  saveDocumentSilently: () => Promise<boolean>
  clearPendingRevisionInBackend: (blockId: string) => Promise<void>
  applyPendingRevisionInBackend: (blockId: string, mode: 'accept' | 'reject') => Promise<boolean>
  updateDiffStatsAfterSingleAction: (
    blockId: string,
    changeType: RevisionChangeType,
    action: 'accept' | 'reject'
  ) => void
}

export interface RevisionBlockActions {
  acceptAllRevisions: (blockId: string, options?: BlockRevisionActionOptions) => Promise<void>
  rejectAllRevisions: (blockId: string, options?: BlockRevisionActionOptions) => Promise<void>
  acceptSingleRevision: (blockId: string, from: number, to: number) => Promise<void>
  rejectSingleRevision: (blockId: string, from: number, to: number) => Promise<void>
}

export function createRevisionBlockActions(
  options: RevisionBlockActionsOptions
): RevisionBlockActions {
  function getPendingCount(): number {
    return Object.keys(options.canonicalPendingSessions.value).length
  }

  function getActiveCount(): number {
    return Object.keys(options.activeRevisions.value).length
  }

  function clearLocalPending(blockId: string): void {
    delete options.activeRevisions.value[blockId]
    delete options.canonicalPendingSessions.value[blockId]
  }

  async function persistBlockAction(
    blockId: string,
    mode: 'accept' | 'reject',
    actionOptions: BlockRevisionActionOptions | undefined,
    perf: RevisionActionPerfSession
  ): Promise<boolean> {
    const shouldSave = actionOptions?.deferSave !== true
    const shouldClearBackend = actionOptions?.deferBackendClear !== true

    if (shouldClearBackend) {
      const appliedInBackend = await perf.measureAsync('backend', () => (
        options.applyPendingRevisionInBackend(blockId, mode)
      ))
      if (appliedInBackend) return true
    }

    if (shouldSave) {
      const saved = await perf.measureAsync('save', () => options.saveDocumentSilently())
      if (!saved) {
        console.warn('[RevisionStore] persistBlockAction: 保存失败，已跳过清理后端 pending，避免数据丢失', {
          blockId,
        })
        return false
      }
    }

    if (shouldClearBackend) {
      await perf.measureAsync('backend', () => options.clearPendingRevisionInBackend(blockId))
    }
    return true
  }

  function deleteRootBlock(blockId: string, label: string, perf: RevisionActionPerfSession): boolean {
    const blockPos = perf.measure('locate', () => findRootBlockPosById(options.editor, blockId))
    if (blockPos == null) {
      console.warn(`[RevisionStore] ${label}: 未找到对应 rootBlock, blockId=`, blockId)
      return false
    }

    const root = options.editor.state.doc.nodeAt(blockPos)
    if (!root || root.type.name !== 'rootBlock') {
      console.warn(`[RevisionStore] ${label}: 未找到有效 rootBlock, blockId=`, blockId)
      return false
    }

    perf.measure('command', () => {
      const tr = options.editor.state.tr.delete(blockPos, blockPos + root.nodeSize)
      options.editor.view.dispatch(tr)
    })
    return true
  }

  async function tryAcceptCanonicalOnlyFastPath(
    blockId: string,
    actionOptions: BlockRevisionActionOptions | undefined,
    perf: RevisionActionPerfSession
  ): Promise<RevisionActionPath | null> {
    const canonical = options.canonicalPendingSessions.value[blockId]
    const active = options.activeRevisions.value[blockId]
    if (!canonical || active?.status === 'pending') return null
    if (canonical.operation !== 'delete') return null

    // canonical-only 的 delete 接受语义是“删除当前 rootBlock”。
    // 这里不需要先 materialize revisionMark，否则会为一个可由 operation 直接表达的动作多做 diff 投影。
    const deleted = deleteRootBlock(blockId, 'acceptAllRevisions(delete fast-path)', perf)
    if (!deleted) return 'noop'

    perf.measure('state', () => clearLocalPending(blockId))
    const persisted = await persistBlockAction(blockId, 'accept', actionOptions, perf)
    return persisted ? 'canonical-delete-root' : 'failed'
  }

  async function tryRejectCanonicalOnlyFastPath(
    blockId: string,
    actionOptions: BlockRevisionActionOptions | undefined,
    perf: RevisionActionPerfSession
  ): Promise<RevisionActionPath | null> {
    const canonical = options.canonicalPendingSessions.value[blockId]
    const active = options.activeRevisions.value[blockId]
    if (!canonical || active?.status === 'pending') return null

    // canonical-only 的 update/delete 拒绝语义是“保留当前正文，只清掉 pending”。
    // 先投影 revisionMark 再拒绝，会产生完全可避免的 Markdown 解析与 PM 事务。
    if (canonical.operation === 'update' || canonical.operation === 'delete') {
      perf.measure('state', () => clearLocalPending(blockId))
      if (actionOptions?.deferBackendClear !== true) {
        const appliedInBackend = await perf.measureAsync('backend', () => (
          options.applyPendingRevisionInBackend(blockId, 'reject')
        ))
        if (!appliedInBackend) {
          await perf.measureAsync('backend', () => options.clearPendingRevisionInBackend(blockId))
        }
      }
      return 'canonical-clear-only'
    }

    if (canonical.operation !== 'insert') return null

    // canonical-only 的 insert 拒绝语义是“删除插入占位块”。
    const deleted = deleteRootBlock(blockId, 'rejectAllRevisions(insert fast-path)', perf)
    if (!deleted) return 'noop'

    perf.measure('state', () => clearLocalPending(blockId))
    const persisted = await persistBlockAction(blockId, 'reject', actionOptions, perf)
    return persisted ? 'canonical-delete-root' : 'failed'
  }

  async function finalizeSingleRevisionIfResolved(
    blockId: string,
    fallbackStatus: 'applied' | 'discarded'
  ): Promise<void> {
    const state = options.activeRevisions.value[blockId]
    if (!state) return

    const blockPos = findRootBlockPosById(options.editor, blockId)
    if (blockPos == null) return

    if (hasRevisionMarksInBlock(options.editor, blockPos, state.revisionId)) {
      return
    }

    options.activeRevisions.value[blockId] = {
      ...state,
      status: fallbackStatus,
      diffStats: {
        insertCount: 0,
        deleteCount: 0,
      },
    }
    delete options.canonicalPendingSessions.value[blockId]

    const saved = await options.saveDocumentSilently()
    if (!saved) {
      console.warn('[RevisionStore] finalizeSingleRevisionIfResolved: 保存失败，已跳过清理后端 pending，避免数据丢失')
      return
    }

    await options.clearPendingRevisionInBackend(blockId)
  }

  async function acceptAllRevisions(
    blockId: string,
    actionOptions?: BlockRevisionActionOptions
  ): Promise<void> {
    const perf = createRevisionActionPerfSession({
      kind: 'block-accept',
      blockId,
      pendingCountBefore: getPendingCount(),
      activeCountBefore: getActiveCount(),
    })

    try {
      const fastPath = await tryAcceptCanonicalOnlyFastPath(blockId, actionOptions, perf)
      if (fastPath) {
        perf.finish({ path: fastPath, result: fastPath === 'failed' ? 'failed' : 'success' })
        return
      }

      const state = await perf.measureAsync('resolve', () => resolvePendingBlockRevisionForAction({
        editor: options.editor,
        blockId,
        options: actionOptions,
        activeRevisions: options.activeRevisions,
        hasCanonicalPending: options.hasCanonicalPending,
        projectPendingRevisionsForBlocks: options.projectPendingRevisionsForBlocks,
        getRevisionState: options.getRevisionState,
      }))
      if (!state || state.status !== 'pending') {
        perf.finish({ path: 'noop', result: 'skipped' })
        return
      }

      const blockPos = perf.measure('locate', () => findRootBlockPosById(options.editor, blockId))
      if (blockPos == null) {
        console.warn('[RevisionStore] acceptAllRevisions: 未找到对应 rootBlock, blockId=', blockId)
        perf.finish({ path: 'noop', result: 'skipped' })
        return
      }

      const ok = perf.measure('command', () => options.editor.commands.acceptAllRevisionsInBlock(blockPos, state.revisionId))
      if (!ok) {
        console.warn('[RevisionStore] acceptAllRevisions: 命令执行失败, blockId=', blockId, 'revisionId=', state.revisionId)
        perf.finish({ path: 'failed', result: 'failed', error: 'acceptAllRevisionsInBlock returned false' })
        return
      }

      perf.measure('state', () => {
        options.activeRevisions.value[blockId] = {
          ...state,
          status: 'applied',
        }
        delete options.canonicalPendingSessions.value[blockId]
      })

      const persisted = await persistBlockAction(blockId, 'accept', actionOptions, perf)
      perf.finish({ path: persisted ? 'projected-command' : 'failed', result: persisted ? 'success' : 'failed' })
    } catch (error) {
      perf.finish({ path: 'failed', result: 'failed', error })
      throw error
    }
  }

  async function rejectAllRevisions(
    blockId: string,
    actionOptions?: BlockRevisionActionOptions
  ): Promise<void> {
    const perf = createRevisionActionPerfSession({
      kind: 'block-reject',
      blockId,
      pendingCountBefore: getPendingCount(),
      activeCountBefore: getActiveCount(),
    })

    try {
      const fastPath = await tryRejectCanonicalOnlyFastPath(blockId, actionOptions, perf)
      if (fastPath) {
        perf.finish({ path: fastPath, result: fastPath === 'failed' ? 'failed' : 'success' })
        return
      }

      const state = await perf.measureAsync('resolve', () => resolvePendingBlockRevisionForAction({
        editor: options.editor,
        blockId,
        options: actionOptions,
        activeRevisions: options.activeRevisions,
        hasCanonicalPending: options.hasCanonicalPending,
        projectPendingRevisionsForBlocks: options.projectPendingRevisionsForBlocks,
        getRevisionState: options.getRevisionState,
      }))
      if (!state || state.status !== 'pending') {
        perf.finish({ path: 'noop', result: 'skipped' })
        return
      }

      const blockPos = perf.measure('locate', () => findRootBlockPosById(options.editor, blockId))
      if (blockPos == null) {
        console.warn('[RevisionStore] rejectAllRevisions: 未找到对应 rootBlock, blockId=', blockId)
        perf.finish({ path: 'noop', result: 'skipped' })
        return
      }

      if (state.operation === 'insert') {
        const root = options.editor.state.doc.nodeAt(blockPos)
        if (!root || root.type.name !== 'rootBlock') {
          console.warn('[RevisionStore] rejectAllRevisions(insert): 未找到有效 rootBlock, blockId=', blockId)
          perf.finish({ path: 'noop', result: 'skipped' })
          return
        }

        perf.measure('command', () => {
          const tr = options.editor.state.tr.delete(blockPos, blockPos + root.nodeSize)
          options.editor.view.dispatch(tr)
        })

        perf.measure('state', () => clearLocalPending(blockId))
        const persisted = await persistBlockAction(blockId, 'reject', actionOptions, perf)
        perf.finish({ path: persisted ? 'projected-command' : 'failed', result: persisted ? 'success' : 'failed' })
        return
      }

      const ok = perf.measure('command', () => options.editor.commands.rejectAllRevisionsInBlock(blockPos, state.revisionId))
      if (!ok) {
        console.warn('[RevisionStore] rejectAllRevisions: 命令执行失败, blockId=', blockId, 'revisionId=', state.revisionId)
        perf.finish({ path: 'failed', result: 'failed', error: 'rejectAllRevisionsInBlock returned false' })
        return
      }

      perf.measure('state', () => {
        options.activeRevisions.value[blockId] = {
          ...state,
          status: 'discarded',
        }
        delete options.canonicalPendingSessions.value[blockId]
      })

      const persisted = await persistBlockAction(blockId, 'reject', actionOptions, perf)
      perf.finish({ path: persisted ? 'projected-command' : 'failed', result: persisted ? 'success' : 'failed' })
    } catch (error) {
      perf.finish({ path: 'failed', result: 'failed', error })
      throw error
    }
  }

  async function acceptSingleRevision(blockId: string, from: number, to: number): Promise<void> {
    const state = options.activeRevisions.value[blockId]
    if (!state || state.status !== 'pending') return

    const node = options.editor.state.doc.nodeAt(from)
    if (!node) return

    const revisionMark = node.marks.find((mark) => mark.type.name === 'revisionMark')
    if (!revisionMark) return

    const changeType = revisionMark.attrs.changeType as RevisionChangeType

    if (changeType === 'delete') {
      options.editor.chain().focus().setTextSelection({ from, to }).deleteSelection().run()
    } else {
      options.editor.chain().focus().setTextSelection({ from, to }).unsetMark('revisionMark').run()
    }

    options.updateDiffStatsAfterSingleAction(blockId, changeType, 'accept')
    await finalizeSingleRevisionIfResolved(blockId, 'applied')
  }

  async function rejectSingleRevision(blockId: string, from: number, to: number): Promise<void> {
    const state = options.activeRevisions.value[blockId]
    if (!state || state.status !== 'pending') return

    const node = options.editor.state.doc.nodeAt(from)
    if (!node) return

    const revisionMark = node.marks.find((mark) => mark.type.name === 'revisionMark')
    if (!revisionMark) return

    const changeType = revisionMark.attrs.changeType as RevisionChangeType

    if (changeType === 'insert') {
      options.editor.chain().focus().setTextSelection({ from, to }).deleteSelection().run()
    } else {
      options.editor.chain().focus().setTextSelection({ from, to }).unsetMark('revisionMark').run()
    }

    options.updateDiffStatsAfterSingleAction(blockId, changeType, 'reject')
    await finalizeSingleRevisionIfResolved(blockId, 'discarded')
  }

  return {
    acceptAllRevisions,
    rejectAllRevisions,
    acceptSingleRevision,
    rejectSingleRevision,
  }
}
