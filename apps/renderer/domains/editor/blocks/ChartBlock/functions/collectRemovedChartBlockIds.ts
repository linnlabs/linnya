/**
 * @file collectRemovedChartBlockIds.ts
 * @description 一次事务真正删除了哪些图表块：用于释放它们的会话级阅读状态。
 *
 * 只检查各步骤被替换掉的范围（成本与被删内容成正比，不扫描整篇文档）；同一事务又把同一块
 * 放回去（移动、改属性）不算删除。撤销重做再次出现的块使用默认视图。
 */

import { type Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'

const CHART_BLOCK = 'chartBlock'

function readId(node: ProseMirrorNode): string | null {
  const id: unknown = node.attrs['id']
  return typeof id === 'string' && id !== '' ? id : null
}

function collectFromRange(doc: ProseMirrorNode, from: number, to: number, into: Set<string>): void {
  if (to <= from) return
  doc.nodesBetween(from, to, node => {
    if (node.type.name === CHART_BLOCK) {
      const id = readId(node)
      if (id) into.add(id)
      return false
    }
    return true
  })
}

/** 使用公开 StepMap 合同，不依赖步骤实现类及其 npm 副本身份。 */
export function collectRemovedChartBlockIds(transaction: Transaction): readonly string[] {
  if (!transaction.docChanged) return []
  const removed = new Set<string>()
  transaction.steps.forEach((step, index) => {
    const before = transaction.docs[index]
    if (!before) return
    step.getMap().forEach((from, to) => collectFromRange(before, from, to, removed))
  })
  // 以最终文档判定移动/删除；中间步骤插回后又删除的块仍然需要清理。
  if (removed.size > 0) transaction.doc.descendants(node => {
    if (node.type.name === CHART_BLOCK) {
      const id = readId(node)
      if (id) removed.delete(id)
    }
    return removed.size > 0
  })
  return [...removed]
}
