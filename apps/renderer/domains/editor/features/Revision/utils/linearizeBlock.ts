/**
 * @file linearizeBlock.ts
 * @description 文档 → TextSpan[] 抽取器
 *
 * 从 ProseMirror 编辑器的 rootBlock 中抽取带 marks 信息的 spans 序列。
 * 用于获取当前文档内容，与 AI 返回的新内容进行 diff。
 */

import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import type { CitationInlineMeta, MarkName, TextSpan } from '../protocol/revisionTextSpanTypes'

// ==================== 类型定义 ====================

/** 抽取结果 */
export interface LinearizeResult {
  /** 解析后的 spans 序列 */
  spans: TextSpan[]
  /** 扁平化后的纯文本（用于 diff） */
  plainText: string
}

/** 支持的 mark 类型映射 */
const SUPPORTED_MARKS: ReadonlySet<string> = new Set(['bold', 'italic', 'code', 'strike'])

// ==================== 核心逻辑 ====================

/**
 * 从 ProseMirror Mark 列表中提取我们支持的 mark 名称
 */
function extractMarkNames(marks: readonly { type: { name: string } }[]): MarkName[] {
  return marks.map(m => m.type.name).filter((name): name is MarkName => SUPPORTED_MARKS.has(name))
}

/**
 * 从 CitationNode attrs 中提取 citation 元数据。
 */
function extractCitationMeta(attrs: Record<string, unknown>): CitationInlineMeta | undefined {
  const sourceType = attrs.sourceType
  const ref = attrs.ref
  const sourceId = attrs.sourceId
  const title = attrs.title
  const snippet = attrs.snippet
  const kbId = attrs.kbId
  const blockId = attrs.blockId
  const url = attrs.url
  const date = attrs.date
  const authors = attrs.authors
  const containerTitle = attrs.containerTitle

  if (typeof sourceId !== 'string' || typeof title !== 'string' || typeof snippet !== 'string') {
    return undefined
  }

  if (kbId !== undefined && kbId !== null && typeof kbId !== 'string') {
    return undefined
  }
  if (blockId !== undefined && blockId !== null && typeof blockId !== 'string') {
    return undefined
  }

  return {
    ref: typeof ref === 'string' && ref.trim().length > 0 ? ref : 'existing-citation',
    sourceType:
      sourceType === 'knowledge_base' || sourceType === 'web' || sourceType === 'manual'
        ? sourceType
        : undefined,
    sourceId,
    title,
    snippet,
    kbId: typeof kbId === 'string' ? kbId : undefined,
    blockId: typeof blockId === 'string' ? blockId : undefined,
    url: typeof url === 'string' ? url : undefined,
    date: typeof date === 'string' ? date : undefined,
    authors:
      Array.isArray(authors) && authors.every(author => typeof author === 'string')
        ? authors
        : undefined,
    containerTitle: typeof containerTitle === 'string' ? containerTitle : undefined,
  }
}

/**
 * 检查两个 mark 数组是否相同
 */
function marksEqual(a: TextSpan, b: TextSpan): boolean {
  const marksA = a.marks
  const marksB = b.marks
  if (marksA.length !== marksB.length) return false
  const sortedA = [...marksA].sort()
  const sortedB = [...marksB].sort()
  const sameCitation =
    a.citation?.ref === b.citation?.ref &&
    a.citation?.sourceType === b.citation?.sourceType &&
    a.citation?.sourceId === b.citation?.sourceId &&
    a.citation?.title === b.citation?.title &&
    a.citation?.snippet === b.citation?.snippet &&
    a.citation?.kbId === b.citation?.kbId &&
    a.citation?.blockId === b.citation?.blockId &&
    a.citation?.url === b.citation?.url &&
    a.citation?.date === b.citation?.date &&
    a.citation?.containerTitle === b.citation?.containerTitle &&
    JSON.stringify(a.citation?.authors ?? []) === JSON.stringify(b.citation?.authors ?? [])
  if (!sameCitation) return false
  const sameInlineAtom =
    JSON.stringify(a.inlineAtom ?? null) === JSON.stringify(b.inlineAtom ?? null)
  if (!sameInlineAtom) return false
  return sortedA.every((mark, i) => mark === sortedB[i])
}

/**
 * 合并相邻的具有相同 marks 的 spans
 */
function mergeAdjacentSpans(spans: TextSpan[]): TextSpan[] {
  if (spans.length === 0) return []

  const merged: TextSpan[] = []
  let current: TextSpan = {
    text: spans[0].text,
    marks: [...spans[0].marks],
    citation: spans[0].citation,
    inlineAtom: spans[0].inlineAtom,
  }

  for (let i = 1; i < spans.length; i++) {
    const next = spans[i]
    if (marksEqual(current, next)) {
      // 合并文本
      current.text += next.text
    } else {
      // 保存当前，开始新的
      if (current.text) {
        merged.push(current)
      }
      current = {
        text: next.text,
        marks: [...next.marks],
        citation: next.citation,
        inlineAtom: next.inlineAtom,
      }
    }
  }

  // 添加最后一个
  if (current.text) {
    merged.push(current)
  }

  return merged
}

function inlineLatexToText(node: ProseMirrorNode): string {
  const latexSource =
    node.attrs && typeof node.attrs.latexSource === 'string' ? node.attrs.latexSource : ''
  return latexSource ? `$${latexSource}$` : '$$'
}

function citationNodeToText(node: ProseMirrorNode): string {
  const ref = node.attrs && typeof node.attrs.ref === 'string' ? node.attrs.ref.trim() : ''
  return ref ? `[@${ref}]` : '【citation】'
}

// ==================== 公共 API ====================

/**
 * 从编辑器的 rootBlock 中抽取带 marks 的 spans
 *
 * @param editor - Tiptap 编辑器实例
 * @param blockPos - rootBlock 在文档中的位置
 * @returns 抽取结果，包含 spans 和 plainText；如果失败返回 null
 *
 * @example
 * ```ts
 * const result = linearizeRootBlock(editor, blockPos)
 * if (result) {
 *   console.log(result.spans) // [{ text: 'Hello', marks: [] }, { text: 'World', marks: ['bold'] }]
 *   console.log(result.plainText) // 'HelloWorld'
 * }
 * ```
 */
export function linearizeRootBlock(editor: Editor, blockPos: number): LinearizeResult | null {
  const rootBlockNode = editor.state.doc.nodeAt(blockPos)
  if (!rootBlockNode || rootBlockNode.type.name !== 'rootBlock') {
    return null
  }

  const spans: TextSpan[] = []
  const blockStart = blockPos + 1 // 跳过 rootBlock 开始标签
  const blockEnd = blockPos + rootBlockNode.nodeSize - 1 // 不包括 rootBlock 结束标签

  editor.state.doc.nodesBetween(blockStart, blockEnd, (node, _pos) => {
    if (node.isText && node.text) {
      // 提取该文本节点的 marks
      const markNames = extractMarkNames(node.marks)
      spans.push({
        text: node.text,
        marks: markNames,
      })
    } else if (node.type.name === 'hardBreak') {
      // 硬换行转为 \n
      spans.push({
        text: '\n',
        marks: [],
      })
    } else if (node.type.name === 'inlineLatex') {
      const textRepresentation = inlineLatexToText(node)
      spans.push({
        text: textRepresentation,
        marks: extractMarkNames(node.marks),
        inlineAtom: {
          type: 'inlineLatex',
          latexSource:
            node.attrs && typeof node.attrs.latexSource === 'string' ? node.attrs.latexSource : '',
          textRepresentation,
          attrs: node.attrs && typeof node.attrs === 'object' ? { ...node.attrs } : undefined,
        },
      })
    } else if (node.type.name === 'citationNode') {
      const citation = extractCitationMeta(node.attrs)
      if (!citation) return
      const textRepresentation = citationNodeToText(node)
      spans.push({
        text: textRepresentation,
        marks: extractMarkNames(node.marks),
        citation,
        inlineAtom: {
          type: 'citation',
          citation,
          textRepresentation,
        },
      })
    }
    // 其他节点类型（如块级节点）不直接处理，只处理其内部的文本节点
  })

  // 合并相邻同类 spans
  const mergedSpans = mergeAdjacentSpans(spans)

  return {
    spans: mergedSpans,
    plainText: mergedSpans.map(s => s.text).join(''),
  }
}

/**
 * 从 ProseMirror Node 中抽取带 marks 的 spans（不依赖 Editor 实例）
 *
 * 用于测试或其他需要直接处理 Node 的场景。
 *
 * @param node - ProseMirror Node（通常是 rootBlock 或其子节点）
 * @returns 抽取结果
 */
export function linearizeNode(node: ProseMirrorNode): LinearizeResult {
  const spans: TextSpan[] = []

  // 递归遍历节点
  function traverse(n: ProseMirrorNode): void {
    if (n.isText && n.text) {
      const markNames = extractMarkNames(n.marks)
      spans.push({
        text: n.text,
        marks: markNames,
      })
    } else if (n.type.name === 'hardBreak') {
      spans.push({
        text: '\n',
        marks: [],
      })
    } else if (n.type.name === 'inlineLatex') {
      const textRepresentation = inlineLatexToText(n)
      spans.push({
        text: textRepresentation,
        marks: extractMarkNames(n.marks),
        inlineAtom: {
          type: 'inlineLatex',
          latexSource:
            n.attrs && typeof n.attrs.latexSource === 'string' ? n.attrs.latexSource : '',
          textRepresentation,
          attrs: n.attrs && typeof n.attrs === 'object' ? { ...n.attrs } : undefined,
        },
      })
    } else if (n.type.name === 'citationNode') {
      const citation = extractCitationMeta(n.attrs)
      if (!citation) return
      const textRepresentation = citationNodeToText(n)
      spans.push({
        text: textRepresentation,
        marks: extractMarkNames(n.marks),
        citation,
        inlineAtom: {
          type: 'citation',
          citation,
          textRepresentation,
        },
      })
    } else if (n.content) {
      // 遍历子节点
      n.content.forEach(child => traverse(child))
    }
  }

  traverse(node)

  // 合并相邻同类 spans
  const mergedSpans = mergeAdjacentSpans(spans)

  return {
    spans: mergedSpans,
    plainText: mergedSpans.map(s => s.text).join(''),
  }
}

// ==================== 导出 ====================

export default {
  linearizeRootBlock,
  linearizeNode,
}
