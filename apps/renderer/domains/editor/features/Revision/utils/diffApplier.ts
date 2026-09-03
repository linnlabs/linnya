/**
 * @file diffApplier.ts
 * @description 将 Diff 结果应用到 ProseMirror 编辑器
 *
 * 核心功能：
 * - 根据 diff 结果，在编辑器中添加 RevisionMark
 * - 支持 insert（新增）和 delete（删除）两种标记
 * - 在单个 transaction 中完成所有操作，保证原子性
 * - 【Phase 2 新增】支持 RichDiffSegment，insert 时可附加语义 marks（bold/italic 等）
 */

import type { Editor } from '@tiptap/core'
import type { Transaction } from 'prosemirror-state'
import {
  Fragment,
  type Mark,
  type MarkType,
  type Node as ProseMirrorNode,
  type Schema,
} from 'prosemirror-model'
import { generateBlockId } from '../../../../../shared/utils/idUtils'
import { computeTextDiff, computeDiffStats, type DiffSegment, type DiffStats } from './diffUtils'
import type { RichDiffSegment, RichDiffResult } from './richDiff'
import type {
  CitationInlineMeta,
  InlineAtom,
  MarkName,
  TextSpan,
} from '../protocol/revisionTextSpanTypes'
import { findRevisionMarkOnNode } from './revisionInlineNodes'
import { infoRevisionDebug, logRevisionDebug, shouldLogRevisionDebug } from './revisionDebugLogging'
import { resolveCurrentEditorMessage } from '../../../functions/resolveCurrentEditorMessage'

// ==================== 类型定义 ====================

/** 应用 Diff 的参数 */
export interface ApplyDiffParams {
  /** Tiptap 编辑器实例 */
  editor: Editor
  /** 块在文档中的位置 */
  blockPos: number
  /** 原始文本 */
  originalText: string
  /** AI 生成的新文本 */
  newText: string
  /** 修订会话 ID */
  revisionId: string
  /** 修订来源 */
  source?: 'ai' | 'user'
  /**
   * 事务元数据（用于控制 dirty / history 等副作用）
   *
   * 常见用法：
   * - `{ internal: true }`：避免 editorFactory.onTransaction 把本次变更标记为 dirty
   * - `{ addToHistory: false }`：避免进入 undo/redo 历史栈
   *
   * 注意：meta key 必须与上层约定保持一致（例如 editorFactory 使用 'internal'）。
   */
  transactionMeta?: Record<string, unknown>
}

/** 应用 Diff 的结果 */
export interface ApplyDiffResult {
  /** 是否成功 */
  success: boolean
  /** 错误信息 */
  error?: string
  /** Diff 统计 */
  diffStats?: DiffStats
}

/** 应用 Rich Diff 的参数（Phase 2 新增） */
export interface ApplyRichDiffParams {
  /** Tiptap 编辑器实例 */
  editor: Editor
  /** 块在文档中的位置 */
  blockPos: number
  /** Rich Diff 结果（包含 segments 和 stats） */
  richDiff: RichDiffResult
  /** 修订会话 ID */
  revisionId: string
  /** 修订来源 */
  source?: 'ai' | 'user'
  /** insert 段中的换行如何落地到文档节点 */
  insertNewlineMode?: InsertedTextNewlineMode
  /** 事务元数据（用于控制 dirty / history 等副作用），见 ApplyDiffParams.transactionMeta 说明 */
  transactionMeta?: Record<string, unknown>
}

/** 块内文本位置信息 */
interface BlockTextInfo {
  /** 文本内容 */
  text: string
  /** 文本在文档中的起始位置 */
  startPos: number
  /** 文本在文档中的结束位置 */
  endPos: number
}

export type InsertedTextNewlineMode = 'hardBreak' | 'literalText'

function generateCitationId(): string {
  return crypto.randomUUID()
}

function citationNodeText(node: ProseMirrorNode): string {
  const ref = node.attrs && typeof node.attrs.ref === 'string' ? node.attrs.ref.trim() : ''
  return ref ? `[@${ref}]` : '【citation】'
}

export function buildInsertedInlineNodes(
  schema: Schema,
  text: string,
  marks: Mark[] = [],
  newlineMode: InsertedTextNewlineMode = 'hardBreak'
): ProseMirrorNode[] {
  if (!text) {
    return []
  }

  if (newlineMode === 'literalText') {
    return [schema.text(text, marks)]
  }

  const hardBreakType = schema.nodes.hardBreak
  const parts = text.split('\n')
  const nodes: ProseMirrorNode[] = []

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]
    if (part.length > 0) {
      nodes.push(schema.text(part, marks))
    }

    if (i < parts.length - 1) {
      if (hardBreakType) {
        nodes.push(hardBreakType.create(null, null, marks))
      } else {
        nodes.push(schema.text('\n', marks))
      }
    }
  }

  return nodes
}

export function buildInsertedNodesForRichSegment(
  schema: Schema,
  segment: Pick<RichDiffSegment, 'text' | 'inlineAtom'>,
  marks: Mark[] = [],
  newlineMode: InsertedTextNewlineMode = 'hardBreak'
): ProseMirrorNode[] {
  const inlineAtom = segment.inlineAtom

  if (inlineAtom?.type === 'inlineLatex') {
    const inlineLatexType = schema.nodes.inlineLatex
    if (inlineLatexType) {
      try {
        return [
          inlineLatexType.create(
            {
              id: generateBlockId(),
              ...(inlineAtom.attrs ?? {}),
              latexSource: inlineAtom.latexSource,
            },
            null,
            marks
          ),
        ]
      } catch {
        // 回退为纯文本，避免因为节点构造失败导致整个修订应用失败。
      }
    }
  }

  if (inlineAtom?.type === 'citation') {
    const citationNodeType = schema.nodes.citationNode
    if (!citationNodeType) {
      throw new Error('Revision 无法物化 citation：schema 未注册 CitationNode。')
    }
    const citation = inlineAtom.citation
    const sourceType =
      citation.sourceType === 'web' || citation.sourceType === 'manual'
        ? citation.sourceType
        : 'knowledge_base'
    return [
      citationNodeType.create(
        {
          citationId: generateCitationId(),
          ...(citation.ref !== 'existing-citation' ? { ref: citation.ref } : {}),
          sourceType,
          sourceId: citation.sourceId,
          title: citation.title,
          snippet: citation.snippet,
          ...(citation.kbId ? { kbId: citation.kbId } : {}),
          ...(citation.blockId ? { blockId: citation.blockId } : {}),
          ...(citation.url ? { url: citation.url } : {}),
          ...(citation.date ? { date: citation.date } : {}),
          ...(citation.authors && citation.authors.length > 0 ? { authors: citation.authors } : {}),
          ...(citation.containerTitle ? { containerTitle: citation.containerTitle } : {}),
        },
        null,
        marks
      ),
    ]
  }

  return buildInsertedInlineNodes(schema, segment.text, marks, newlineMode)
}

function insertInlineNodes(tr: Transaction, pos: number, nodes: ProseMirrorNode[]): void {
  if (nodes.length === 0) {
    return
  }

  if (nodes.length === 1) {
    tr.insert(pos, nodes[0])
    return
  }

  tr.insert(pos, Fragment.fromArray(nodes))
}

// ==================== 核心函数 ====================

/**
 * 将 Diff 结果应用到编辑器的指定块中
 *
 * 工作流程：
 * 1. 获取块的原始文本和位置信息
 * 2. 计算原始文本与新文本的 diff
 * 3. 在单个 transaction 中：
 *    - 对于 delete 片段：给原文添加 revisionMark (changeType: 'delete')
 *    - 对于 insert 片段：插入新文本并添加 revisionMark (changeType: 'insert')
 *
 * @param params - 应用参数
 * @returns 应用结果
 */
export function applyDiffToDocument(params: ApplyDiffParams): ApplyDiffResult {
  const {
    editor,
    blockPos,
    originalText,
    newText,
    revisionId,
    source = 'ai',
    transactionMeta,
  } = params

  try {
    // 1. 获取块节点
    const rootBlockNode = editor.state.doc.nodeAt(blockPos)
    if (!rootBlockNode || rootBlockNode.type.name !== 'rootBlock') {
      return { success: false, error: '未找到有效的 rootBlock 节点' }
    }

    // 2. 获取 revisionMark 类型
    const revisionMarkType = editor.state.schema.marks.revisionMark
    if (!revisionMarkType) {
      return { success: false, error: 'revisionMark 类型未注册' }
    }

    // 3. 计算 diff
    const diffSegments = computeTextDiff(originalText, newText)

    if (import.meta.env.DEV && shouldLogRevisionDebug()) {
      logRevisionDebug('[diffApplier] 计算出的 diffSegments:', diffSegments)
    }

    const diffStats = computeDiffStats(diffSegments)

    // 如果没有差异，直接返回
    if (diffStats.insertCount === 0 && diffStats.deleteCount === 0) {
      return { success: true, diffStats }
    }

    // 4. 获取块内文本的位置信息
    const blockTextInfo = getBlockTextInfo(editor, blockPos, rootBlockNode)
    if (!blockTextInfo) {
      return { success: false, error: '无法获取块内文本位置信息' }
    }

    // 5. 在单个 transaction 中应用所有变更
    const { tr } = editor.state

    // 应用 diff 到 transaction
    const applyResult = applyDiffSegmentsToTransaction(
      tr,
      diffSegments,
      blockTextInfo.startPos,
      revisionMarkType,
      revisionId,
      source
    )

    if (!applyResult.success) {
      return { success: false, error: applyResult.error }
    }

    // 6. 写入 transaction meta（可选）
    if (transactionMeta && typeof transactionMeta === 'object') {
      for (const [key, value] of Object.entries(transactionMeta)) {
        tr.setMeta(key, value)
      }
    }

    // 7. 提交 transaction
    editor.view.dispatch(tr)

    return { success: true, diffStats }
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : resolveCurrentEditorMessage('editor.common.unknownError')
    console.error('[diffApplier] 应用 diff 失败:', error)
    return { success: false, error: errorMessage }
  }
}

/**
 * 【Phase 2 新增】将 Rich Diff 结果应用到编辑器的指定块中
 *
 * 与 applyDiffToDocument 的区别：
 * - 接收预先计算好的 RichDiffResult（包含 segments 和 stats）
 * - insert 段可以携带语义 marks（bold/italic/code/strike），会与 revisionMark 一起附加到新文本
 *
 * @param params - 应用参数
 * @returns 应用结果
 */
export function applyRichDiffToDocument(params: ApplyRichDiffParams): ApplyDiffResult {
  const {
    editor,
    blockPos,
    richDiff,
    revisionId,
    source = 'ai',
    insertNewlineMode = 'hardBreak',
    transactionMeta,
  } = params

  try {
    // 1. 获取块节点
    const rootBlockNode = editor.state.doc.nodeAt(blockPos)
    if (!rootBlockNode || rootBlockNode.type.name !== 'rootBlock') {
      return { success: false, error: '未找到有效的 rootBlock 节点' }
    }

    // 2. 获取 revisionMark 类型
    const revisionMarkType = editor.state.schema.marks.revisionMark
    if (!revisionMarkType) {
      return { success: false, error: 'revisionMark 类型未注册' }
    }

    const { segments, stats: diffStats } = richDiff
    const citationInsertSegments = segments.filter(s => s.type === 'insert' && !!s.citation).length

    // 如果没有差异，直接返回
    if (diffStats.insertCount === 0 && diffStats.deleteCount === 0) {
      return { success: true, diffStats }
    }

    // 3. 获取块内文本的位置信息
    const blockTextInfo = getBlockTextInfo(editor, blockPos, rootBlockNode)
    if (!blockTextInfo) {
      return { success: false, error: '无法获取块内文本位置信息' }
    }

    if (import.meta.env.DEV && shouldLogRevisionDebug()) {
      logRevisionDebug('[diffApplier] 应用 RichDiff:', {
        segmentCount: segments.length,
        diffStats,
        hasMarkedInserts: segments.some(s => s.type === 'insert' && s.marks && s.marks.length > 0),
        citationInsertSegments,
      })
    }
    infoRevisionDebug(
      `[diffApplier] 准备应用 RichDiff: blockPos=${blockPos}, segmentCount=${segments.length}, citationInsertSegments=${citationInsertSegments}`
    )

    // 4. 在单个 transaction 中应用所有变更
    const { tr } = editor.state

    // 应用 rich diff 到 transaction
    const applyResult = applyRichDiffSegmentsToTransaction(
      tr,
      segments,
      blockTextInfo.startPos,
      revisionMarkType,
      revisionId,
      source,
      0,
      insertNewlineMode
    )

    if (!applyResult.success) {
      return { success: false, error: applyResult.error }
    }

    // 5. 写入 transaction meta（可选）
    if (transactionMeta && typeof transactionMeta === 'object') {
      for (const [key, value] of Object.entries(transactionMeta)) {
        tr.setMeta(key, value)
      }
    }

    // 6. 提交 transaction
    editor.view.dispatch(tr)

    return { success: true, diffStats }
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : resolveCurrentEditorMessage('editor.common.unknownError')
    console.error('[diffApplier] 应用 rich diff 失败:', error)
    return { success: false, error: errorMessage }
  }
}

/**
 * 获取块内纯文本及其位置信息
 */
function getBlockTextInfo(
  editor: Editor,
  blockPos: number,
  rootBlockNode: ReturnType<typeof editor.state.doc.nodeAt>
): BlockTextInfo | null {
  if (!rootBlockNode) return null

  const blockStart = blockPos + 1 // 跳过 rootBlock 开始标签
  const blockEnd = blockPos + rootBlockNode.nodeSize - 1 // 不包括 rootBlock 结束标签

  // 提取纯文本
  let text = ''
  let firstTextPos: number | null = null

  editor.state.doc.nodesBetween(blockStart, blockEnd, (node, pos) => {
    if (node.isText) {
      if (firstTextPos === null) {
        firstTextPos = pos
      }
      text += node.text || ''
    } else if (node.type.name === 'hardBreak') {
      if (firstTextPos === null) {
        firstTextPos = pos
      }
      text += '\n'
    } else if (node.type.name === 'inlineLatex') {
      if (firstTextPos === null) {
        firstTextPos = pos
      }
      const latexSource =
        node.attrs && typeof node.attrs.latexSource === 'string' ? node.attrs.latexSource : ''
      text += latexSource ? `$${latexSource}$` : '$$'
    } else if (node.type.name === 'citationNode') {
      if (firstTextPos === null) firstTextPos = pos
      text += citationNodeText(node)
    }
  })

  if (firstTextPos === null) {
    // 块内没有文本，使用内容块的起始位置
    firstTextPos = blockStart + 1 // 跳过内容块开始标签
  }

  return {
    text,
    startPos: firstTextPos,
    endPos: blockEnd,
  }
}

/**
 * 将 diff 片段应用到 transaction
 *
 * 核心逻辑：
 * - 从后往前处理，避免位置偏移问题
 * - delete 片段：在原位置添加 revisionMark
 * - insert 片段：插入新文本并添加 revisionMark
 */
function applyDiffSegmentsToTransaction(
  tr: Transaction,
  segments: DiffSegment[],
  basePos: number,
  revisionMarkType: ReturnType<
    (typeof tr.doc.type.schema.marks)['revisionMark']['create']
  > extends infer R
    ? R extends { type: infer T }
      ? T
      : never
    : never,
  revisionId: string,
  source: 'ai' | 'user'
): { success: boolean; error?: string } {
  try {
    // 计算每个片段在原文档中的位置
    interface PositionedSegment {
      type: 'equal' | 'insert' | 'delete'
      text: string
      originalStartPos: number // 在原文档中的起始位置
      originalEndPos: number // 在原文档中的结束位置
    }

    const positionedSegments: PositionedSegment[] = []
    let currentOriginalPos = basePos

    for (const segment of segments) {
      if (segment.type === 'equal') {
        // 相等部分，只移动位置
        currentOriginalPos += segment.text.length
      } else if (segment.type === 'delete') {
        // 删除部分，记录原位置
        positionedSegments.push({
          type: 'delete',
          text: segment.text,
          originalStartPos: currentOriginalPos,
          originalEndPos: currentOriginalPos + segment.text.length,
        })
        currentOriginalPos += segment.text.length
      } else {
        // 插入部分，记录插入点
        positionedSegments.push({
          type: 'insert',
          text: segment.text,
          originalStartPos: currentOriginalPos,
          originalEndPos: currentOriginalPos,
        })
        // insert 不移动原文档位置
      }
    }

    // 从后往前处理，避免位置偏移
    positionedSegments.sort((a, b) => b.originalStartPos - a.originalStartPos)

    for (const segment of positionedSegments) {
      // 计算在当前 transaction 中的实际位置
      const mappedStart = tr.mapping.map(segment.originalStartPos)
      // 关键修复：使用 assoc = -1 映射结束位置。
      // 如果在 originalEndPos 处刚刚插入了内容（insert segment），
      // 默认 map (assoc=1) 会把位置推到插入内容之后，导致 addMark 误伤新插入的文本。
      // 使用 -1 可以确保结束位置停留在插入内容之前。
      const mappedEnd = tr.mapping.map(segment.originalEndPos, -1)

      if (segment.type === 'delete') {
        // 删除类型：给原文添加 revisionMark (changeType: 'delete')
        const deleteMark = revisionMarkType.create({
          revisionId,
          changeType: 'delete',
          source,
        })
        tr.addMark(mappedStart, mappedEnd, deleteMark)
      } else if (segment.type === 'insert') {
        // 插入类型：插入新文本并添加 revisionMark (changeType: 'insert')
        const insertMark = revisionMarkType.create({
          revisionId,
          changeType: 'insert',
          source,
        })

        const nodes = buildInsertedInlineNodes(tr.doc.type.schema, segment.text, [insertMark])
        insertInlineNodes(tr, mappedStart, nodes)
      }
    }

    return { success: true }
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : resolveCurrentEditorMessage('editor.common.unknownError')
    return { success: false, error: errorMessage }
  }
}

/**
 * 【Phase 2 新增】将 Rich Diff 片段应用到 transaction
 *
 * 与 applyDiffSegmentsToTransaction 的主要区别：
 * - insert 段会附加语义 marks（bold/italic/code/strike）
 * - marks 顺序：语义 marks 在前，revisionMark 在后，确保修订样式在最外层
 */
function applyRichDiffSegmentsToTransaction(
  tr: Transaction,
  segments: RichDiffSegment[],
  basePos: number,
  revisionMarkType: MarkType,
  revisionId: string,
  source: 'ai' | 'user',
  mappingFrom: number = 0,
  insertNewlineMode: InsertedTextNewlineMode = 'hardBreak'
): { success: boolean; error?: string } {
  try {
    const schema = tr.doc.type.schema
    // 计算每个片段在原文档中的位置
    interface PositionedRichSegment {
      type: 'equal' | 'insert' | 'delete'
      text: string
      marks?: MarkName[]
      /** citation 元数据（仅 insert 有意义），从 RichDiffSegment 透传 */
      citation?: CitationInlineMeta
      /** inline 原子节点语义（仅 insert 有意义），从 RichDiffSegment 透传 */
      inlineAtom?: InlineAtom
      originalStartPos: number
      originalEndPos: number
    }

    const positionedSegments: PositionedRichSegment[] = []
    let currentOriginalPos = basePos

    for (const segment of segments) {
      const unitCount = segment.unitCount ?? segment.text.length

      if (segment.type === 'equal') {
        // 相等部分，只移动位置
        currentOriginalPos += unitCount
      } else if (segment.type === 'delete') {
        // 删除部分，记录原位置
        positionedSegments.push({
          type: 'delete',
          text: segment.text,
          originalStartPos: currentOriginalPos,
          originalEndPos: currentOriginalPos + unitCount,
        })
        currentOriginalPos += unitCount
      } else {
        // 插入部分，记录插入点、marks 和 citation
        positionedSegments.push({
          type: 'insert',
          text: segment.text,
          marks: segment.marks,
          citation: segment.citation,
          inlineAtom: segment.inlineAtom,
          originalStartPos: currentOriginalPos,
          originalEndPos: currentOriginalPos,
        })
        // insert 不移动原文档位置
      }
    }

    // 从后往前处理，避免位置偏移
    positionedSegments.sort((a, b) => b.originalStartPos - a.originalStartPos)

    for (const segment of positionedSegments) {
      // 计算在当前 transaction 中的实际位置
      // 动态获取从 mappingFrom 开始的最新 mapping，确保包含刚刚插入的步骤
      const currentMapping = mappingFrom > 0 ? tr.mapping.slice(mappingFrom) : tr.mapping
      const mappedStart = currentMapping.map(segment.originalStartPos)
      const mappedEnd = currentMapping.map(segment.originalEndPos, -1)

      if (segment.type === 'delete') {
        // 删除类型：给原文添加 revisionMark (changeType: 'delete')
        const deleteMark = revisionMarkType.create({
          revisionId,
          changeType: 'delete',
          source,
        })
        tr.addMark(mappedStart, mappedEnd, deleteMark)
      } else if (segment.type === 'insert') {
        // 插入类型：插入新文本，附加 revisionMark + 语义 marks

        // 1. 收集语义 marks（从 RichDiffSegment 获取）
        const semanticMarks: Mark[] = []
        if (segment.marks && segment.marks.length > 0) {
          for (const markName of segment.marks) {
            const markType = schema.marks[markName]
            if (markType) {
              semanticMarks.push(markType.create())
            }
          }
        }

        // 2. 创建 revisionMark
        const insertMark = revisionMarkType.create({
          revisionId,
          changeType: 'insert',
          source,
        })

        // 3. Citation 是可携带 mark 的 inline atom；修订与语义 mark 直接附着在节点上。
        const allMarks = [...semanticMarks, insertMark]

        // 4. 将 `\n` 拆成 hardBreak，保持与块线性化文本一致
        const nodes = buildInsertedNodesForRichSegment(schema, segment, allMarks, insertNewlineMode)
        insertInlineNodes(tr, mappedStart, nodes)
      }
    }

    return { success: true }
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : resolveCurrentEditorMessage('editor.common.unknownError')
    return { success: false, error: errorMessage }
  }
}

/**
 * 获取块内纯文本及其位置信息（基于任意 doc，不依赖 Editor）
 * 用于 mega-transaction 批处理场景
 */
function getBlockTextInfoFromDoc(
  doc: import('prosemirror-model').Node,
  blockPos: number,
  rootBlockNode: import('prosemirror-model').Node | null | undefined
): BlockTextInfo | null {
  if (!rootBlockNode) return null

  const blockStart = blockPos + 1
  const blockEnd = blockPos + rootBlockNode.nodeSize - 1

  let text = ''
  let firstTextPos: number | null = null

  doc.nodesBetween(blockStart, blockEnd, (node, pos) => {
    if (node.isText) {
      if (firstTextPos === null) {
        firstTextPos = pos
      }
      text += node.text || ''
    } else if (node.type.name === 'hardBreak') {
      if (firstTextPos === null) {
        firstTextPos = pos
      }
      text += '\n'
    } else if (node.type.name === 'inlineLatex') {
      if (firstTextPos === null) {
        firstTextPos = pos
      }
      const latexSource =
        node.attrs && typeof node.attrs.latexSource === 'string' ? node.attrs.latexSource : ''
      text += latexSource ? `$${latexSource}$` : '$$'
    } else if (node.type.name === 'citationNode') {
      if (firstTextPos === null) firstTextPos = pos
      text += citationNodeText(node)
    }
  })

  if (firstTextPos === null) {
    firstTextPos = blockStart + 1
  }

  return {
    text,
    startPos: firstTextPos,
    endPos: blockEnd,
  }
}

/** mega-transaction 批处理用参数 */
export interface ApplyRichDiffToTrParams {
  /** 要操作的 transaction（会被就地修改） */
  tr: Transaction
  /** 块在 tr.doc 中的位置 */
  blockPos: number
  /** Rich Diff 结果 */
  richDiff: RichDiffResult
  /** 修订会话 ID */
  revisionId: string
  /** 修订来源 */
  source?: 'ai' | 'user'
  /** insert 段中的换行如何落地到文档节点 */
  insertNewlineMode?: InsertedTextNewlineMode
}

/**
 * 将 Rich Diff 应用到已有 transaction（不 dispatch）
 * 用于 mega-transaction 批处理：多个 block 的 diff 累积到同一个 tr 中
 */
export function applyRichDiffToTr(params: ApplyRichDiffToTrParams): ApplyDiffResult {
  const {
    tr,
    blockPos,
    richDiff,
    revisionId,
    source = 'ai',
    insertNewlineMode = 'hardBreak',
  } = params

  try {
    const mappingFrom = tr.mapping.maps.length
    const doc = tr.doc
    const rootBlockNode = doc.nodeAt(blockPos)
    if (!rootBlockNode || rootBlockNode.type.name !== 'rootBlock') {
      return { success: false, error: '未找到有效的 rootBlock 节点' }
    }

    const revisionMarkType = doc.type.schema.marks.revisionMark
    if (!revisionMarkType) {
      return { success: false, error: 'revisionMark 类型未注册' }
    }

    const { segments, stats: diffStats } = richDiff
    if (diffStats.insertCount === 0 && diffStats.deleteCount === 0) {
      return { success: true, diffStats }
    }

    const blockTextInfo = getBlockTextInfoFromDoc(doc, blockPos, rootBlockNode)
    if (!blockTextInfo) {
      return { success: false, error: '无法获取块内文本位置信息' }
    }

    const applyResult = applyRichDiffSegmentsToTransaction(
      tr,
      segments,
      blockTextInfo.startPos,
      revisionMarkType,
      revisionId,
      source,
      mappingFrom,
      insertNewlineMode
    )

    if (!applyResult.success) {
      return { success: false, error: applyResult.error }
    }

    return { success: true, diffStats }
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : resolveCurrentEditorMessage('editor.common.unknownError')
    return { success: false, error: errorMessage }
  }
}

/**
 * 从块中提取纯文本
 * 用于获取原始内容进行 diff 计算
 *
 * @param editor - 编辑器实例
 * @param blockPos - 块位置
 * @returns 纯文本内容
 */
export function extractBlockText(editor: Editor, blockPos: number): string | null {
  const rootBlockNode = editor.state.doc.nodeAt(blockPos)
  if (!rootBlockNode || rootBlockNode.type.name !== 'rootBlock') {
    return null
  }

  const blockTextInfo = getBlockTextInfo(editor, blockPos, rootBlockNode)
  return blockTextInfo?.text ?? null
}

/**
 * 清除块内所有 revisionMark
 * 用于取消修订或重新开始修订
 *
 * @param editor - 编辑器实例
 * @param blockPos - 块位置
 * @param revisionId - 可选，只清除指定 revisionId 的标记
 */
export function clearBlockRevisionMarks(
  editor: Editor,
  blockPos: number,
  revisionId?: string
): boolean {
  try {
    const rootBlockNode = editor.state.doc.nodeAt(blockPos)
    if (!rootBlockNode || rootBlockNode.type.name !== 'rootBlock') {
      return false
    }

    const revisionMarkType = editor.state.schema.marks.revisionMark
    if (!revisionMarkType) {
      return false
    }

    const blockStart = blockPos + 1
    const blockEnd = blockPos + rootBlockNode.nodeSize - 1
    const { tr } = editor.state

    if (revisionId) {
      // 只清除指定 revisionId 的标记
      editor.state.doc.nodesBetween(blockStart, blockEnd, (node, pos) => {
        const revisionMark = findRevisionMarkOnNode(node, revisionMarkType, revisionId)
        if (revisionMark) {
          tr.removeMark(pos, pos + node.nodeSize, revisionMarkType)
        }
      })
    } else {
      editor.state.doc.nodesBetween(blockStart, blockEnd, (node, pos) => {
        const revisionMark = findRevisionMarkOnNode(node, revisionMarkType)
        if (revisionMark) {
          tr.removeMark(pos, pos + node.nodeSize, revisionMarkType)
        }
      })
    }

    editor.view.dispatch(tr)

    return true
  } catch (error) {
    console.error('[diffApplier] 清除 revisionMark 失败:', error)
    return false
  }
}

// ==================== 导出 ====================

export default {
  applyDiffToDocument,
  applyRichDiffToDocument,
  extractBlockText,
  clearBlockRevisionMarks,
}
