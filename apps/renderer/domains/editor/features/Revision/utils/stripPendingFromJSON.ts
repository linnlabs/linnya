/**
 * @file stripPendingFromJSON.ts
 * @description 从编辑器序列化的 JSON 中剥离所有 pending 投影（revisionMark marks + insert 块），
 * 确保 content_json 只存储基线内容。
 *
 * 核心原则（revision === pending 统一后）：
 * - content_json 永远只存基线内容，不包含任何 revisionMark。
 * - canonical pending session 驱动的投影（insert 块 / revisionMark）按语义剥离。
 * - 文档中残留的"孤儿 revisionMark"（无对应 canonical）也一律剥离并记录警告。
 *
 * 处理规则：
 * - operation='insert' 的 canonical 块：整块移除（基线中不存在）
 * - 其他块中的 revisionMark：
 *   - changeType='insert' 的 inline 节点：移除（新增的行内内容）
 *   - changeType='delete' 的 inline 节点：保留节点，剥离 revisionMark（恢复原始内容）
 */

import type { CanonicalPendingSession } from '../store/types'

type JSONNode = Record<string, unknown>

/**
 * 从文档 JSON 中剥离所有 revisionMark 投影。
 * 对 canonical insert 块执行整块移除，对所有其他块递归清除 revisionMark。
 */
export function stripWorkspacePendingFromJSON(
  docJSON: JSONNode,
  canonicalSessions: Record<string, CanonicalPendingSession>
): JSONNode {
  const content = docJSON.content as JSONNode[] | undefined
  if (!content) return docJSON

  const cleanContent: JSONNode[] = []
  let orphanMarkCount = 0

  for (const block of content) {
    if (block.type !== 'rootBlock') {
      // 非 rootBlock 也递归清理（防止嵌套结构里残留 revisionMark）
      const cleaned = stripRevisionMarksFromNode(block)
      if (cleaned) cleanContent.push(cleaned)
      continue
    }

    const blockId = (block.attrs as JSONNode)?.id as string | undefined
    const session = blockId ? canonicalSessions[blockId] : undefined

    // Phase 7: 块实体唯一来源
    // canonical insert 块在基线中作为空块存在，文本由 pending revision 提供。
    // 因此不能整块跳过，只需剥离其中的 revisionMark 即可（这会将其还原为空块）。

    // 对所有 rootBlock 递归剥离 revisionMark（不管是否有 canonical session）
    const result = stripRevisionMarksFromNodeWithStats(block)
    if (result.node) {
      cleanContent.push(result.node)
    }

    // 无对应 canonical 但发现了 revisionMark → 孤儿 mark
    if (!session && result.strippedCount > 0) {
      orphanMarkCount += result.strippedCount
    }
  }

  if (orphanMarkCount > 0) {
    console.warn(
      `[stripPendingFromJSON] 剥离了 ${orphanMarkCount} 个孤儿 revisionMark（无对应 canonical session）`
    )
  }

  return { ...docJSON, content: cleanContent }
}

interface StripResult {
  node: JSONNode | null
  strippedCount: number
}

/**
 * 递归处理节点树，剥离 revisionMark 并统计数量。
 */
function stripRevisionMarksFromNodeWithStats(node: JSONNode): StripResult {
  if (Array.isArray(node.marks)) {
    const marks = node.marks as JSONNode[]
    const revisionMark = marks.find(m => m.type === 'revisionMark')

    if (revisionMark) {
      const changeType = (revisionMark.attrs as JSONNode)?.changeType

      if (changeType === 'insert') {
        return { node: null, strippedCount: 1 }
      }

      if (changeType === 'delete') {
        const otherMarks = marks.filter(m => m.type !== 'revisionMark')
        if (otherMarks.length > 0) {
          return { node: { ...node, marks: otherMarks }, strippedCount: 1 }
        }
        const { marks: _, ...rest } = node
        return { node: rest, strippedCount: 1 }
      }

      // 未知 changeType 的 revisionMark 也剥离
      const otherMarks = marks.filter(m => m.type !== 'revisionMark')
      if (otherMarks.length > 0) {
        return { node: { ...node, marks: otherMarks }, strippedCount: 1 }
      }
      const { marks: _, ...rest } = node
      return { node: rest, strippedCount: 1 }
    }
  }

  if (Array.isArray(node.content)) {
    let totalStripped = 0
    const children: JSONNode[] = []

    for (const child of node.content as JSONNode[]) {
      const result = stripRevisionMarksFromNodeWithStats(child)
      totalStripped += result.strippedCount
      if (result.node) children.push(result.node)
    }

    return { node: { ...node, content: children }, strippedCount: totalStripped }
  }

  return { node, strippedCount: 0 }
}

/** 向后兼容：简单版本（不带统计） */
function stripRevisionMarksFromNode(node: JSONNode): JSONNode | null {
  return stripRevisionMarksFromNodeWithStats(node).node
}
