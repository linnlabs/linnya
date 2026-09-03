/**
 * @file revisionMarkScan.ts
 * @description 从文档中扫描 revisionMark（已降级为校验/调试用途）。
 *
 * 架构定位：
 * - 全局统计的唯一事实源已切换为 canonicalPendingSessions，不再依赖 doc mark 扫描。
 * - 本模块保留的能力用于：
 *   1. 撤销/重做后 mark 投影层的状态校正（getRevisionState 内部）
 *   2. 单片段操作后判断该块是否还有剩余 mark（finalizeSingleRevisionIfResolved）
 *   3. 开发期一致性断言：canonical store 与 mark 投影是否漂移
 */

import type { Editor } from '@tiptap/core'
import type { CanonicalPendingSession } from './types'
import {
  findRevisionMarkOnNode,
  getInlineRevisionUnitCount,
} from '../utils/revisionInlineNodes'

export type RevisionMarkScanResult = {
  revisionId: string
  diffStats: { insertCount: number; deleteCount: number }
}

/**
 * 扫描块内容，提取该块中的 revisionMark 信息。
 *
 * 用途：仅用于 mark 投影层的 undo/redo 状态校正，不参与全局统计。
 */
export function scanBlockForRevisions(editor: Editor, blockPos: number): RevisionMarkScanResult | null {
  const { doc, schema } = editor.state
  const revisionMarkType = schema.marks.revisionMark
  if (!revisionMarkType) return null

  const rootBlockNode = doc.nodeAt(blockPos)
  if (!rootBlockNode) return null

  const blockStart = blockPos
  const blockEnd = blockPos + rootBlockNode.nodeSize

  let firstRevisionId: string | null = null
  let insertCount = 0
  let deleteCount = 0
  let hasRevisions = false

  doc.nodesBetween(blockStart, blockEnd, (node) => {
    const revisionMark = findRevisionMarkOnNode(node, revisionMarkType)
    if (!revisionMark) return

    hasRevisions = true

    if (!firstRevisionId) {
      firstRevisionId = revisionMark.attrs.revisionId as string
    }

    if (revisionMark.attrs.revisionId === firstRevisionId) {
      const changeType = revisionMark.attrs.changeType as string
      const unitCount = getInlineRevisionUnitCount(node)
      if (changeType === 'insert') insertCount += unitCount
      if (changeType === 'delete') deleteCount += unitCount
    }
  })

  if (hasRevisions && firstRevisionId) {
    return {
      revisionId: firstRevisionId,
      diffStats: { insertCount, deleteCount },
    }
  }

  return null
}

/**
 * 判断某个 rootBlock 范围内是否存在指定 revisionId 的 revisionMark。
 *
 * 用途：单片段操作后判断该块是否还有剩余的 revisionMark（finalizeSingleRevisionIfResolved）。
 */
export function hasRevisionMarksInBlock(editor: Editor, blockPos: number, revisionId: string): boolean {
  const { doc, schema } = editor.state
  const revisionMarkType = schema.marks.revisionMark
  if (!revisionMarkType) return false

  const rootBlockNode = doc.nodeAt(blockPos)
  if (!rootBlockNode) return false

  const blockStart = blockPos
  const blockEnd = blockPos + rootBlockNode.nodeSize

  let found = false
  doc.nodesBetween(blockStart, blockEnd, (node) => {
    const revisionMark = findRevisionMarkOnNode(node, revisionMarkType, revisionId)
    if (revisionMark) {
      found = true
      return false
    }
    return
  })

  return found
}

/**
 * 开发期一致性校验：检查 canonical sessions 与文档中的 mark 投影是否漂移。
 *
 * 典型调用时机：
 * - setWorkspacePendingRevisions 完成后（在 nextTick 中）
 * - 调试时手动调用
 *
 * 返回漂移信息（空数组 = 无漂移）。
 */
export function validateCanonicalVsMarks(
  editor: Editor,
  canonicalSessions: Record<string, CanonicalPendingSession>,
  findRootBlockPosById: (editor: Editor, blockId: string) => number | null
): Array<{ blockId: string; issue: string }> {
  const issues: Array<{ blockId: string; issue: string }> = []

  for (const [blockId, session] of Object.entries(canonicalSessions)) {
    const blockPos = findRootBlockPosById(editor, blockId)
    if (blockPos == null) {
      issues.push({ blockId, issue: 'canonical session 存在但文档中未找到对应 rootBlock' })
      continue
    }

    const scanResult = scanBlockForRevisions(editor, blockPos)
    if (!scanResult) {
      issues.push({ blockId, issue: 'canonical session 存在但文档中无 revisionMark' })
      continue
    }

    if (scanResult.revisionId !== session.revisionId) {
      issues.push({
        blockId,
        issue: `revisionId 不匹配: canonical=${session.revisionId}, mark=${scanResult.revisionId}`,
      })
    }
  }

  return issues
}
