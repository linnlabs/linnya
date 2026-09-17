/**
 * @file revisionMarkScan.ts
 * @description 读取 revisionMark 投影供物化校验和诊断使用。
 *
 * 架构定位：
 * - 全局统计的唯一事实源已切换为 canonicalPendingSessions，不再依赖 doc mark 扫描。
 * - 本模块保留的能力用于：
 *   1. 插入块物化时识别已存在的投影并计算显示统计
 *   2. 开发期诊断当前可见标记；未投影不代表数据库没有 Pending
 */

import type { Editor } from '@tiptap/core'
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
 * 仅描述当前投影，不用于重建、清理或提交 Pending。
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
 * 插入块物化时识别同一版本的已有投影，避免重复添加标记。
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
