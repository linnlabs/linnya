/**
 * @file citation/plugins/bibliographyAutoMaintain.ts
 * @description 参考文献自动维护的纯逻辑层
 *
 * 本文件提供纯函数，用于：
 * 1. 扫描文档获取 citations 数量和 bibliography 位置
 * 2. 根据扫描结果计算需要执行的修正动作
 *
 * 设计原则：
 * - 纯函数，无副作用，便于单测
 * - 不直接操作 ProseMirror Transaction，只返回修正动作描述
 * - 实际的 Transaction 构造由 CitationFeatureExtension 负责
 */

import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model'
import type { DocCitationScanResult, BibliographyFixAction, BibliographyFixResult } from '../types'

/**
 * 扫描文档，获取 citations 数量和 bibliography 位置信息
 *
 * @param doc - ProseMirror 文档节点
 * @returns 扫描结果
 */
export function scanDocForCitations(doc: ProseMirrorNode): DocCitationScanResult {
  let citationCount = 0
  const bibliographyRootBlockPosList: number[] = []
  let lastRootBlockEndPos = 0

  // 遍历文档
  doc.descendants((node, pos, parent) => {
    if (node.type.name === 'citationNode') citationCount++

    // 识别 bibliographyBlock 所在的 rootBlock
    if (node.type.name === 'bibliographyBlock' && parent) {
      // 向上找到 rootBlock
      // bibliographyBlock 的直接父节点应该是 rootBlock
      // 但由于 descendants 的遍历方式，我们需要另一种方法来找到 rootBlock 的位置
      // 这里我们记录 bibliographyBlock 自身的位置，后续再映射到 rootBlock
    }

    // 跟踪 rootBlock 位置
    if (node.type.name === 'rootBlock') {
      lastRootBlockEndPos = pos + node.nodeSize
    }

    return true // 继续遍历
  })

  // 第二次遍历：专门找 bibliographyBlock 所在的 rootBlock
  // 由于文档结构是 doc -> rootBlock -> contentBlock，我们需要遍历 doc 的直接子节点
  let currentPos = 0
  doc.forEach((rootBlockNode, offset) => {
    const rootBlockPos = offset
    // 检查 rootBlock 的第一个子节点是否是 bibliographyBlock
    if (rootBlockNode.type.name === 'rootBlock' && rootBlockNode.firstChild) {
      if (rootBlockNode.firstChild.type.name === 'bibliographyBlock') {
        bibliographyRootBlockPosList.push(rootBlockPos)
      }
    }
    currentPos = rootBlockPos + rootBlockNode.nodeSize
  })

  // 判断 bibliography 是否在文末
  let isBibliographyAtEnd = false
  if (bibliographyRootBlockPosList.length === 1) {
    // 获取最后一个 rootBlock 的位置
    let lastRootBlockPos = 0
    doc.forEach((_, offset) => {
      lastRootBlockPos = offset
    })
    isBibliographyAtEnd = bibliographyRootBlockPosList[0] === lastRootBlockPos
  }

  return {
    citationCount,
    bibliographyRootBlockPosList,
    isBibliographyAtEnd,
    docEndPos: doc.content.size,
  }
}

/**
 * 根据扫描结果计算需要执行的修正动作
 *
 * 规则：
 * - 规则 A：最多一个 BibliographyBlock（容器块）
 * - 规则 B：有 citation → bibliography 必须存在
 * - 规则 C：无 citation → bibliography 必须不存在
 * - 规则 D：bibliography 容器块必须位于文末
 *
 * @param scanResult - 文档扫描结果
 * @returns 修正动作列表
 */
export function computeBibliographyFixActions(
  scanResult: DocCitationScanResult
): BibliographyFixResult {
  const { citationCount, bibliographyRootBlockPosList, isBibliographyAtEnd, docEndPos } = scanResult
  const actions: BibliographyFixAction[] = []

  const bibliographyCount = bibliographyRootBlockPosList.length

  // 情况 1：没有 citation
  if (citationCount === 0) {
    if (bibliographyCount > 0) {
      // 规则 C：无 citation → 移除所有 bibliography
      actions.push({
        type: 'remove',
        positions: [...bibliographyRootBlockPosList],
      })
    }
    // 否则无需修正
  }
  // 情况 2：有 citation
  else {
    if (bibliographyCount === 0) {
      // 规则 B：有 citation 但没有 bibliography → 创建
      actions.push({
        type: 'create',
        insertPos: docEndPos,
      })
    } else if (bibliographyCount > 1) {
      // 规则 A：多个 bibliography → 只保留最后一个，移除其他
      // 保留最后一个（位置最大的）
      const sortedPositions = [...bibliographyRootBlockPosList].sort((a, b) => a - b)
      const keepPos = sortedPositions[sortedPositions.length - 1]
      const removePositions = sortedPositions.slice(0, -1)

      actions.push({
        type: 'cleanup_duplicates',
        keepPos,
        removePositions,
      })

      // 清理后如果保留的不在文末，还需要移动
      // 但这个判断需要在清理后重新扫描，这里先不处理
      // 后续的 appendTransaction 会再次触发检查
    } else {
      // 恰好 1 个 bibliography
      if (!isBibliographyAtEnd) {
        // 规则 D：不在文末 → 移动到文末
        actions.push({
          type: 'move_to_end',
          fromPos: bibliographyRootBlockPosList[0],
          toPos: docEndPos,
        })
      }
      // 否则状态正确，无需修正
    }
  }

  return {
    actions,
    needsFix: actions.length > 0,
  }
}

/**
 * 检查是否需要执行修正
 *
 * @param doc - ProseMirror 文档节点
 * @returns 是否需要修正
 */
export function needsBibliographyFix(doc: ProseMirrorNode): boolean {
  const scanResult = scanDocForCitations(doc)
  const fixResult = computeBibliographyFixActions(scanResult)
  return fixResult.needsFix
}

/**
 * 创建 bibliographyBlock 的 JSON 结构
 * 用于插入新的 bibliography
 *
 * @param schema - ProseMirror Schema
 * @param styleId - 样式 ID（默认 'numeric'）
 * @returns rootBlock 包裹的 bibliographyBlock JSON
 */
export function createBibliographyBlockJSON(styleId: 'numeric' | 'author-date' = 'numeric'): {
  type: string
  content: Array<{ type: string; attrs: Record<string, unknown> }>
} {
  return {
    type: 'rootBlock',
    content: [
      {
        type: 'bibliographyBlock',
        attrs: {
          blockType: 'bibliography',
          styleId,
        },
      },
    ],
  }
}

/**
 * 调试日志输出
 * 可通过 localStorage.EDITOR_CITATION_DEBUG=1 开启
 */
export function debugLog(message: string, ...args: unknown[]): void {
  if (
    typeof localStorage !== 'undefined' &&
    localStorage.getItem('EDITOR_CITATION_DEBUG') === '1'
  ) {
    console.log(`[Citation] ${message}`, ...args)
  }
}
