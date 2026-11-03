import type { DocumentReferenceMarkdownBinding } from '@app/schemas';
import { hydrateReferenceProjection } from './documentReferenceHydration';
/**
 * Pending Revision 公共工具方法
 * - rootBlock 定位
 * - 表格节点构建
 * - 整块 insert 标记
 */

import type { Editor } from '@tiptap/core'
import type { Transaction } from 'prosemirror-state'
import type { Node as ProseMirrorNode, Schema } from 'prosemirror-model'
import type { TextSpan } from '../../protocol/revisionTextSpanTypes'
import { generateBlockId } from '../../../../../../shared/utils/idUtils'
import {
  blockEventsToRootBlockNodes,
  buildTableRowsFromInlineProjectionGrid,
  buildTableRowsFromTableModel as materializeTableRowsFromTableModel,
} from '../../../../services/markdownRuntime'
import type { BlockEventLike } from '../../../../services/markdownRuntime'
import { attachCitationHydrationToProjection } from './citationHydrationHelper'
import {
  classifyPendingMarkdownTable,
  classifyPendingMarkdownTopLevelBlock,
  parsePendingMarkdownToInlineProjection,
  type PendingTableModel,
} from './pendingMarkdownRuntime'
import { resolvePlainTextMarkdownFastPath } from './pendingPlainTextFastPath'
import {
  getInlineRevisionUnitCount,
  isTrackableInlineRevisionNode,
} from '../revisionInlineNodes'
import { linearizeNode } from '../linearizeBlock'
import { getBlockPosIndex } from '../../../../extensions/position/blockPosIndex'
import { findContentBlockInRoot } from '../../../../extensions/position/PositionUtils'
import { parsePipeTableMarkdown } from './pipeTableParser'
import { markPendingRevisionProjectionTransaction } from '../../../../core/transactions/editorTransactionMeta'
import { resolveCurrentEditorMessage } from '../../../../functions/resolveCurrentEditorMessage'

/**
 * 根据 blockId 在文档中查找 RootBlock 的起始位置
 *
 * 实现策略：
 * 通过 blockPosIndex 提供的 WeakMap<doc, Map<blockId, pos>> 缓存进行 O(1) 查找。
 * 首次访问当前 doc 时会触发一次 O(N) 索引构建（只遍历到 rootBlock 层级），
 * 同一 doc 的后续查找均为 O(1)，避免了之前每次调用都做全文档遍历的 O(N) 开销。
 */
export function findRootBlockPosById(editor: Editor, blockId: string): number | null {
  const index = getBlockPosIndex(editor.state.doc)
  const pos = index.get(blockId)
  if (pos === undefined) return null

  // 安全校验：确认 pos 处确实是目标 rootBlock（防止索引与实际文档不一致的边界情况）
  const node = editor.state.doc.nodeAt(pos)
  if (!node || node.type.name !== 'rootBlock' || node.attrs.id !== blockId) return null

  return pos
}

/**
 * 在任意 ProseMirror 文档中查找 rootBlock 位置（不依赖 Editor 实例）
 * 用于 mega-transaction 批处理场景，在 tr.doc 上查找位置
 */
export function findRootBlockPosByIdInDoc(doc: ProseMirrorNode, blockId: string): number | null {
  const index = getBlockPosIndex(doc)
  const pos = index.get(blockId)
  if (pos === undefined) return null

  const node = doc.nodeAt(pos)
  if (!node || node.type.name !== 'rootBlock' || node.attrs.id !== blockId) return null

  return pos
}

/** Markdown 物化只依赖 schema，不要求测试或调用方伪造完整 Editor。 */
export interface PendingMarkdownEditor {
  readonly state: { readonly schema: Schema }
}

export interface PendingTableRowsBuildResult {
  rows: ProseMirrorNode[]
  source: 'wasm-table-model' | 'pipe-table-fallback' | 'none'
}

interface PendingMarkdownResolutionBase {
  source: 'runtime-single-block' | 'plain-text-fast-path'
}

export interface PendingContentBlockResolution extends PendingMarkdownResolutionBase {
  kind: 'content-block'
  contentType: string
  blockAttrs: Record<string, unknown>
  cleanMarkdown: string
  spans: TextSpan[]
}

export interface PendingTableBlockResolution extends PendingMarkdownResolutionBase {
  kind: 'table-block'
  tableRowsResult: Exclude<PendingTableRowsBuildResult, { source: 'none' }>
}

/**
 * 没有行内内容的整块（水平分割线、独立公式）。
 * 节点由 markdownRuntime 的 materializer 物化，与完整文档导入得到同样的公式/分割线节点；
 * 执行层整块替换目标 rootBlock 的内容，不经过行内 spans 或文本 diff。
 */
export interface PendingAtomicBlockResolution extends PendingMarkdownResolutionBase {
  kind: 'atomic-block'
  contentBlock: ProseMirrorNode
}

export type PendingMarkdownResolutionResult =
  | PendingContentBlockResolution
  | PendingTableBlockResolution
  | PendingAtomicBlockResolution

export function looksLikeTableMarkdown(markdown: string): boolean {
  if (!markdown.includes('|')) {
    return false
  }

  const nonEmptyLines = markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  return nonEmptyLines.length >= 2
}

export async function buildTableRowsFromTableModel(
  editor: PendingMarkdownEditor,
  model: PendingTableModel,
  hydration?: Record<string, import('@/shared/utils/citationHydration').CitationHydrationData> | null,
  documentReferenceBindings: readonly DocumentReferenceMarkdownBinding[] = [],
): Promise<{ rows: ProseMirrorNode[] }> {
  const usedReferences = new Set<string>();
  const rows = materializeTableRowsFromTableModel(
    model as unknown as Record<string, unknown>,
    editor.state.schema,
    {
      hydrateProjection: (projection) =>
        hydrateReferenceProjection(attachCitationHydrationToProjection(projection, hydration || null), documentReferenceBindings, usedReferences),
    }
  )

  if (!rows || rows.length === 0) {
    return { rows: [] }
  }

  return { rows }
}

/**
 * 从解析后的表格数据构建 ProseMirror 表格节点
 * 
 * 注意：
 * - 这里复用了表格节点的创建逻辑，确保与 tableCoreOperations 中的表格创建保持一致
 * - 列宽设置为默认 150px，与手动创建表格的行为一致
 */
export async function buildTableRowsFromParsedTable(
  editor: PendingMarkdownEditor,
  parsed: {
    headerCells: string[]
    alignments: Array<'left' | 'center' | 'right' | null>
    bodyRows: string[][]
  },
  hydration?: Record<string, import('@/shared/utils/citationHydration').CitationHydrationData> | null
): Promise<{ rows: ProseMirrorNode[] }> {
  const headerProjections = await Promise.all(
    parsed.headerCells.map((cellMarkdown) =>
      parsePendingMarkdownToInlineProjection(cellMarkdown, {
        operation: 'buildTableRowsFromParsedTable',
      })
    )
  )
  const rowProjections = await Promise.all(
    parsed.bodyRows.map((rowCells) =>
      Promise.all(
        rowCells.map((cellMarkdown) =>
          parsePendingMarkdownToInlineProjection(cellMarkdown, {
            operation: 'buildTableRowsFromParsedTable',
          })
        )
      )
    )
  )

  const rows = buildTableRowsFromInlineProjectionGrid(
    {
      withHeaderRow: parsed.headerCells.length > 0,
      header: headerProjections,
      rows: rowProjections,
    },
    editor.state.schema,
    {
      hydrateProjection: (projection) =>
        attachCitationHydrationToProjection(projection, hydration || null),
    }
  )

  return { rows: rows ?? [] }
}

export async function buildTableRowsFromMarkdown(
  editor: PendingMarkdownEditor,
  markdown: string,
  hydration?: Record<string, import('@/shared/utils/citationHydration').CitationHydrationData> | null
): Promise<PendingTableRowsBuildResult> {
  const tableParseResult = await classifyPendingMarkdownTable(markdown, {
    operation: 'buildTableRowsFromMarkdown',
  })
  if (tableParseResult.status === 'table') {
    const { rows } = await buildTableRowsFromTableModel(editor, tableParseResult.model, hydration)
    if (rows.length > 0) {
      return { rows, source: 'wasm-table-model' }
    }
  }

  if (tableParseResult.status === 'mixed-with-meaningful-surroundings') {
    return { rows: [], source: 'none' }
  }

  const parsedTable = parsePipeTableMarkdown(markdown)
  if (!parsedTable) {
    return { rows: [], source: 'none' }
  }

  const { rows } = await buildTableRowsFromParsedTable(editor, parsedTable, hydration)
  if (rows.length === 0) {
    return { rows: [], source: 'none' }
  }

  return { rows, source: 'pipe-table-fallback' }
}

/** 经 materializer 物化 `rootBlock -> 内容块`，只取内容块：目标 rootBlock 的身份与属性由调用方保留。 */
export function materializeAtomicContentBlock(schema: Schema, event: BlockEventLike): ProseMirrorNode {
  const [rootBlock] = blockEventsToRootBlockNodes([event], schema)
  const contentBlock = rootBlock?.firstChild
  if (!contentBlock) {
    throw new Error(`[PendingRevision] ${event.block_type} 没有物化出 rootBlock 内容块`)
  }
  return contentBlock
}

export async function resolvePendingMarkdownForSingleBlock(
  editor: PendingMarkdownEditor,
  markdown: string,
  options: {
    operation: string
    blockId?: string
    listSeparatorBefore?: unknown
    hydration?: Record<string, import('@/shared/utils/citationHydration').CitationHydrationData> | null
    documentReferenceBindings?: readonly DocumentReferenceMarkdownBinding[]
  }
): Promise<PendingMarkdownResolutionResult> {
  const plainTextFastPath = resolvePlainTextMarkdownFastPath(markdown)
  if (plainTextFastPath) {
    return plainTextFastPath
  }

  const runtimeClassification = await classifyPendingMarkdownTopLevelBlock(markdown, {
    operation: options.operation,
    blockId: options.blockId,
  })

  if (runtimeClassification.status === 'single-block') {
    return {
      kind: 'content-block',
      contentType: runtimeClassification.block.contentType,
      blockAttrs: {
        ...runtimeClassification.block.blockAttrs,
        ...(runtimeClassification.block.contentType === 'listItemBlock' &&
          (options.listSeparatorBefore === 'tight' || options.listSeparatorBefore === 'loose')
          ? { separatorBefore: options.listSeparatorBefore } : {}),
      },
      cleanMarkdown: runtimeClassification.block.cleanMarkdown,
      spans:
        runtimeClassification.block.contentType === 'codeBlock'
          ? [{ text: runtimeClassification.block.cleanMarkdown, marks: [] }]
          : (runtimeClassification.block.inlineProjection ? hydrateReferenceProjection(runtimeClassification.block.inlineProjection, options.documentReferenceBindings ?? []).spans : []),
      source: 'runtime-single-block',
    }
  }

  if (runtimeClassification.status === 'atomic-block') {
    return {
      kind: 'atomic-block',
      source: 'runtime-single-block',
      contentBlock: materializeAtomicContentBlock(editor.state.schema, runtimeClassification.event),
    }
  }

  if (runtimeClassification.status === 'table' && editor.state.schema.nodes.table) {
    const { rows } = await buildTableRowsFromTableModel(
      editor,
      runtimeClassification.model,
      options.hydration,
      options.documentReferenceBindings,
    )
    if (rows.length > 0) {
      return {
        kind: 'table-block',
        source: 'runtime-single-block',
        tableRowsResult: { rows, source: 'wasm-table-model' },
      }
    }
  }

  if (runtimeClassification.status === 'empty' && !markdown.trim()) {
    return { kind: 'content-block', contentType: 'baseBlock', blockAttrs: {}, cleanMarkdown: '', spans: [], source: 'runtime-single-block' }
  }
  // 数据库以单 rootBlock 为决策单位；无法物化时必须保留原文，不能猜成段落或截取第一块。
  const reason = runtimeClassification.status === 'multiple-meaningful-blocks'
    ? `Pending 必须对应一个 rootBlock，实际为 ${runtimeClassification.totalBlocks}`
    : runtimeClassification.status === 'unsupported-single-block'
      ? `Pending 不支持的块类型：${runtimeClassification.blockType}`
      : 'Pending 无法物化为一个内容块'
  throw new Error(reason)
}

/**
 * 按 rootBlockPos 转换块类型（复用 ConversionCommands）
 * 
 * 核心策略：
 * 1. 根据 rootBlockPos 找到其内部的 contentBlock（用 PositionUtils）
 * 2. 暂时将选区设置到该 contentBlock 内部（这样 ConversionCommands 能正确识别目标块）
 * 3. 调用 editor.commands.convertBlock(targetType, attrs)，复用现有命令体系
 * 4. 恢复原选区
 * 
 * 这样 Pending Revisions 的类型修正就完全挂在现有命令体系之上，无需重复实现 setNodeMarkup 逻辑。
 * 
 * @param editor - Tiptap 编辑器实例
 * @param rootBlockPos - rootBlock 在文档中的位置
 * @param targetType - 目标块类型（'headingBlock' | 'listItemBlock' | 'quoteBlock' | 'baseBlock' 等）
 * @param attrs - 块属性（例如 { level: 1 } for headingBlock）
 * @returns 是否成功转换
 */
export function convertBlockByRootPos(
  editor: Editor,
  rootBlockPos: number,
  targetType: string,
  attrs: Record<string, unknown> = {}
): boolean {
  try {
    const { state } = editor
    const rootBlockNode = state.doc.nodeAt(rootBlockPos)
    
    if (!rootBlockNode || rootBlockNode.type.name !== 'rootBlock') {
      console.warn('[convertBlockByRootPos] 未找到有效的 rootBlock')
      return false
    }

    // 1. 获取 contentBlock（rootBlock 的第一个子节点）
    const contentBlock = findContentBlockInRoot({ 
      node: rootBlockNode, 
      pos: rootBlockPos 
    }) as { node: ProseMirrorNode; pos: number } | null
    
    if (!contentBlock) {
      console.warn('[convertBlockByRootPos] 未找到 contentBlock')
      return false
    }

    // 2. 保存当前选区
    const originalSelection = state.selection

    // 3. 暂时将选区设置到 contentBlock 内部（选中该块的首个位置）
    // contentBlock.pos 是 contentBlock 的起始位置，+1 进入其内部
    const targetPos = contentBlock.pos + 1
    editor.commands.setTextSelection(targetPos)

    // 4. 调用现有的 convertBlock 命令
    // 注意：ConversionCommands.convertBlock 期望通过 editor.commands 调用，
    // 但它可能不在默认的 commands 集合中，需要确保已注册
    // 这里我们直接复用 ConversionCommands 的逻辑
    let success = false
    
    // 根据目标类型选择对应的转换命令
    if (targetType === 'headingBlock') {
      // @ts-ignore - convertToHeading 在 ConversionCommands 中定义
      success = editor.commands.convertToHeading?.(attrs.level || 1) ?? false
    } else if (targetType === 'listItemBlock') {
      // @ts-ignore - convertToListItem 在 ConversionCommands 中定义
      success = editor.commands.convertToListItem?.(attrs.listType || 'bullet') ?? false
    } else if (targetType === 'quoteBlock') {
      // @ts-ignore - convertToQuoteBlock 在 ConversionCommands 中定义
      success = editor.commands.convertToQuoteBlock?.() ?? false
    } else if (targetType === 'codeBlock') {
      // CodeBlockLowlight 提供 setCodeBlock({ language }) 命令
      const maybeLanguage = typeof attrs.language === 'string' ? attrs.language : null
      const codeAttrs = { language: maybeLanguage }
      const commands = editor.commands as unknown as {
        setCodeBlock?: (p: { language?: string | null }) => boolean
      }
      success = commands.setCodeBlock?.(codeAttrs) ?? false
    } else if (targetType === 'baseBlock') {
      // @ts-ignore - setBaseBlock 在 ConversionCommands 中定义
      success = editor.commands.setBaseBlock?.() ?? false
    } else {
      console.warn(`[convertBlockByRootPos] 不支持的目标类型: ${targetType}`)
    }

    // 5. 恢复原选区（无论成功与否都恢复，避免干扰用户光标）
    try {
      editor.commands.setTextSelection({
        from: originalSelection.from,
        to: originalSelection.to,
      })
    } catch (e) {
      // 如果恢复失败（例如原选区已不存在），静默处理
      console.warn('[convertBlockByRootPos] 恢复选区失败:', e)
    }

    return success
  } catch (error) {
    console.error('[convertBlockByRootPos] 转换失败:', error)
    return false
  }
}

function createConvertedContentBlockNode(
  currentContentNode: ProseMirrorNode,
  targetType: string,
  attrs: Record<string, unknown> = {}
): ProseMirrorNode | null {
  const { schema } = currentContentNode.type
  const blockId =
    typeof currentContentNode.attrs.id === 'string' && currentContentNode.attrs.id.length > 0
      ? currentContentNode.attrs.id
      : generateBlockId()

  if (targetType === 'baseBlock') {
    return schema.nodes.baseBlock?.create(
      {
        ...currentContentNode.attrs,
        ...attrs,
        id: blockId,
        blockType: 'base',
      },
      currentContentNode.content
    ) ?? null
  }

  if (targetType === 'headingBlock') {
    const level =
      typeof attrs.level === 'number' && attrs.level > 0 ? attrs.level : 1

    return schema.nodes.headingBlock?.create(
      {
        ...currentContentNode.attrs,
        ...attrs,
        id: blockId,
        blockType: 'heading',
        level,
        placeholder: resolveCurrentEditorMessage('editor.placeholder.heading', { level }),
      },
      currentContentNode.content
    ) ?? null
  }

  if (targetType === 'listItemBlock') {
    return schema.nodes.listItemBlock?.create(
      {
        ...currentContentNode.attrs,
        ...attrs,
        id: blockId,
        blockType: 'listItem',
        listType: typeof attrs.listType === 'string' ? attrs.listType : 'bullet',
        level: typeof attrs.level === 'number' ? attrs.level : 0,
      },
      currentContentNode.content
    ) ?? null
  }

  if (targetType === 'quoteBlock') {
    return schema.nodes.quoteBlock?.create(
      {
        ...currentContentNode.attrs,
        ...attrs,
        id: blockId,
        blockType: 'quote',
      },
      currentContentNode.content
    ) ?? null
  }

  if (targetType === 'codeBlock') {
    const plainText = linearizeNode(currentContentNode).plainText
    const textNode = plainText.length > 0 ? schema.text(plainText) : null

    return schema.nodes.codeBlock?.create(
      {
        ...currentContentNode.attrs,
        ...attrs,
        id: blockId,
        blockType: 'code',
        language: typeof attrs.language === 'string' ? attrs.language : '',
      },
      textNode ? [textNode] : undefined
    ) ?? null
  }

  return null
}

export function convertBlockByRootPosInTr(
  tr: Transaction,
  rootBlockPos: number,
  targetType: string,
  attrs: Record<string, unknown> = {}
): boolean {
  try {
    const rootBlockNode = tr.doc.nodeAt(rootBlockPos)
    if (!rootBlockNode || rootBlockNode.type.name !== 'rootBlock' || rootBlockNode.childCount === 0) {
      console.warn('[convertBlockByRootPosInTr] 未找到有效的 rootBlock')
      return false
    }

    // rootBlock 恰好包含一个内容块。这里不用面向光标定位的 findContentBlockInRoot 白名单：
    // 它不含水平分割线等原子块，会让“当前内容是分割线”的 update 无法转换成文本块，预览静默丢失新内容。
    const currentContentNode = rootBlockNode.child(0)
    const contentBlockPos = rootBlockPos + 1
    const newNode = createConvertedContentBlockNode(currentContentNode, targetType, attrs)

    if (!newNode) {
      console.warn(`[convertBlockByRootPosInTr] 不支持的目标类型: ${targetType}`)
      return false
    }

    tr.replaceWith(contentBlockPos, contentBlockPos + currentContentNode.nodeSize, newNode)
    return true
  } catch (error) {
    console.error('[convertBlockByRootPosInTr] 转换失败:', error)
    return false
  }
}

/**
 * 为指定 rootBlock 范围内的所有文本节点添加 insert 类型的 revisionMark。
 *
 * 语义：
 * - 用于「整块新增」场景（例如通过 AI 工具插入的整张表格）；
 * - 不再通过 diff 计算具体字符级 diff，而是直接把整块内容视作"插入的候选内容"；
 * - 接受修订：移除 mark，保留表格结构与文字；
 * - 拒绝修订：删除带有 insert 标记的文字（表格结构本身会保留，符合现有命令语义）。
 */
export function markWholeBlockAsInsert(
  editor: Editor,
  blockPos: number,
  revisionId: string
): { insertCount: number; deleteCount: number } {
  const { doc, schema } = editor.state
  const rootBlockNode = doc.nodeAt(blockPos)
  const revisionMarkType = schema.marks.revisionMark

  if (!rootBlockNode || rootBlockNode.type.name !== 'rootBlock' || !revisionMarkType) {
    return { insertCount: 0, deleteCount: 0 }
  }

  // 注意：这里以 rootBlock 整体范围扫描 inline 节点，只给“行内内容”加 insert mark。
  // 这样不会破坏 table/list 等块结构节点本身，同时能覆盖 hardBreak / inlineLatex 等非 text inline。
  const blockStart = blockPos
  const blockEnd = blockPos + rootBlockNode.nodeSize
  const tr = editor.state.tr

  let insertedUnits = 0
  const mark = revisionMarkType.create({
    revisionId,
    changeType: 'insert',
    source: 'ai',
  })

  doc.nodesBetween(blockStart, blockEnd, (node, pos) => {
    if (!isTrackableInlineRevisionNode(node)) return
    insertedUnits += getInlineRevisionUnitCount(node)
    tr.addMark(pos, pos + node.nodeSize, mark)
  })

  if (insertedUnits > 0) {
    markPendingRevisionProjectionTransaction(tr)
    editor.view.dispatch(tr)
  }

  return { insertCount: insertedUnits, deleteCount: 0 }
}

export function markWholeBlockAsInsertInTr(
  tr: Transaction,
  blockPos: number,
  revisionId: string
): { insertCount: number; deleteCount: number } {
  const { doc } = tr
  const revisionMarkType = doc.type.schema.marks.revisionMark
  const rootBlockNode = doc.nodeAt(blockPos)

  if (!rootBlockNode || rootBlockNode.type.name !== 'rootBlock' || !revisionMarkType) {
    return { insertCount: 0, deleteCount: 0 }
  }

  const blockStart = blockPos
  const blockEnd = blockPos + rootBlockNode.nodeSize
  const mark = revisionMarkType.create({
    revisionId,
    changeType: 'insert',
    source: 'ai',
  })

  let insertedUnits = 0
  doc.nodesBetween(blockStart, blockEnd, (node, pos) => {
    if (!isTrackableInlineRevisionNode(node)) return
    insertedUnits += getInlineRevisionUnitCount(node)
    tr.addMark(pos, pos + node.nodeSize, mark)
  })

  return { insertCount: insertedUnits, deleteCount: 0 }
}
