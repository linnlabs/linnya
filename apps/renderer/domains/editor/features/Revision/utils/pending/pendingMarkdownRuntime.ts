import {
  blockEventToInlineProjection,
  blockEventsToInlineProjection,
  parseMarkdownToBlockEvents,
  structuredContentToInlineProjection,
} from '../../../../services/markdownRuntime'
import type { ContentFragmentLike } from '../../../../services/markdownRuntime'
import type {
  BlockEventLike,
  MarkdownInlineProjection,
} from '../../../../services/markdownRuntime/types'
import type { TextSpan } from '../../protocol/revisionTextSpanTypes'

interface PendingMarkdownRuntimeOptions {
  blockId?: string
  operation: string
}

export interface PendingTableCellModel {
  content?: ContentFragmentLike[] | null
}

export interface PendingTableRowModel {
  cells?: PendingTableCellModel[] | null
}

export interface PendingTableModel {
  with_header_row?: boolean
  header?: PendingTableCellModel[] | null
  rows?: PendingTableRowModel[] | null
}

export interface PendingCanonicalBlock {
  contentType: string
  blockAttrs: Record<string, unknown>
  cleanMarkdown: string
  inlineProjection: MarkdownInlineProjection | null
  sourceBlockType: string
}

export type PendingTableParseResult =
  | {
      status: 'table'
      model: PendingTableModel
    }
  | {
      status: 'not-table'
    }
  | {
      status: 'multiple-table-blocks'
      tableCount: number
    }
  | {
      status: 'mixed-with-meaningful-surroundings'
      totalBlocks: number
    }

export type PendingTopLevelBlockParseResult =
  | {
      status: 'single-block'
      block: PendingCanonicalBlock
    }
  | {
      status: 'table'
      model: PendingTableModel
    }
  | {
      status: 'empty'
    }
  | {
      status: 'multiple-meaningful-blocks'
      totalBlocks: number
      blockTypes: string[]
    }
  | {
      status: 'unsupported-single-block'
      blockType: string
    }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function buildPlainTextFallback(markdown: string): TextSpan[] {
  return markdown.length > 0 ? [{ text: markdown, marks: [] }] : []
}

function buildPlainTextProjection(markdown: string): MarkdownInlineProjection {
  return structuredContentToInlineProjection(null, markdown)
}

function hasMeaningfulStructuredContent(structuredContent: unknown): boolean {
  if (!Array.isArray(structuredContent) || structuredContent.length === 0) {
    return false
  }

  for (const fragment of structuredContent) {
    if (!fragment || typeof fragment !== 'object') {
      continue
    }

    const candidate = fragment as { type?: unknown; text?: unknown }
    if (candidate.type === 'text') {
      const text = typeof candidate.text === 'string' ? candidate.text : ''
      if (text.trim().length > 0) {
        return true
      }
      continue
    }

    // 中文说明：
    // - hardBreak-only 片段不应被视为“有意义外围内容”；
    // - 但 inlineLatex / 其他结构化片段一旦出现，说明外围块确实承载了语义内容。
    if (candidate.type !== 'hardBreak') {
      return true
    }
  }

  return false
}

function isTableModelEvent(event: BlockEventLike): event is BlockEventLike & { attrs: PendingTableModel } {
  return event?.block_type === 'TableBlock' && isRecord(event.attrs)
}

function isIgnorableBlockEvent(event: BlockEventLike): boolean {
  if (event.block_type !== 'BaseBlock') {
    return false
  }

  const rawFallback =
    typeof event.raw_content_fallback === 'string' ? event.raw_content_fallback : ''
  if (rawFallback.trim().length > 0) {
    return false
  }

  return !hasMeaningfulStructuredContent(event.structured_content)
}

function mapBlockEventToPendingCanonicalBlock(event: BlockEventLike): PendingCanonicalBlock | null {
  if (event.block_type === 'CodeBlock') {
    return {
      contentType: 'codeBlock',
      blockAttrs: {
        language: typeof event.language === 'string' && event.language.length > 0 ? event.language : null,
      },
      cleanMarkdown:
        typeof event.raw_content_fallback === 'string' ? event.raw_content_fallback : '',
      inlineProjection: null,
      sourceBlockType: event.block_type,
    }
  }

  if (event.block_type === 'TableBlock') {
    return null
  }

  const inlineProjection = blockEventToInlineProjection(event)

  if (event.block_type === 'HeadingBlock') {
    return {
      contentType: 'headingBlock',
      blockAttrs: {
        level: typeof event.level === 'number' && event.level > 0 ? event.level : 1,
      },
      cleanMarkdown: inlineProjection.plainText,
      inlineProjection,
      sourceBlockType: event.block_type,
    }
  }

  if (event.block_type === 'QuoteBlock') {
    return {
      contentType: 'quoteBlock',
      blockAttrs: {},
      cleanMarkdown: inlineProjection.plainText,
      inlineProjection,
      sourceBlockType: event.block_type,
    }
  }

  if (event.block_type === 'ListItemBlock') {
    return {
      contentType: 'listItemBlock',
      blockAttrs: {
        listType: typeof event.list_type === 'string' ? event.list_type : 'bullet',
        ...(typeof event.list_level === 'number' ? { level: event.list_level } : {}),
      },
      cleanMarkdown: inlineProjection.plainText,
      inlineProjection,
      sourceBlockType: event.block_type,
    }
  }

  if (event.block_type === 'BaseBlock') {
    return {
      contentType: 'baseBlock',
      blockAttrs: {},
      cleanMarkdown: inlineProjection.plainText,
      inlineProjection,
      sourceBlockType: event.block_type,
    }
  }

  return null
}

export async function parsePendingMarkdownToInlineProjection(
  markdown: string,
  options: PendingMarkdownRuntimeOptions
): Promise<MarkdownInlineProjection> {
  if (!markdown) {
    return buildPlainTextProjection('')
  }

  const blockEvents = await parseMarkdownToBlockEvents(markdown)
  if (blockEvents.length === 0) {
    console.warn(
      `[${options.operation}] WASM 未产出 block events，回退为纯文本 spans, blockId=${options.blockId ?? 'unknown'}`
    )
    return buildPlainTextProjection(markdown)
  }

  const projection = blockEventsToInlineProjection(blockEvents, {
    multiBlockMode: 'first-block',
    onDroppedBlocks: (info) => {
      console.warn(
        `[${options.operation}] Markdown 解析出多个块，pending 普通块路径仅消费第一块: requested=${info.requestedBlockCount}, dropped=${info.droppedBlockCount}, blockId=${options.blockId ?? 'unknown'}`
      )
    },
  })

  if (projection.spans.length === 0 && markdown.trim().length > 0) {
    console.warn(
      `[${options.operation}] inline projection 为空，回退为纯文本 spans, blockId=${options.blockId ?? 'unknown'}`
    )
    return buildPlainTextProjection(markdown)
  }

  return projection
}

export async function parsePendingMarkdownToSpans(
  markdown: string,
  options: PendingMarkdownRuntimeOptions
): Promise<TextSpan[]> {
  if (!markdown) {
    return []
  }

  const projection = await parsePendingMarkdownToInlineProjection(markdown, options)
  if (projection.spans.length > 0) {
    return projection.spans
  }

  return buildPlainTextFallback(markdown)
}

export async function classifyPendingMarkdownTable(
  markdown: string,
  options: PendingMarkdownRuntimeOptions
): Promise<PendingTableParseResult> {
  if (!markdown || !markdown.includes('|')) {
    return { status: 'not-table' }
  }

  const blockEvents = await parseMarkdownToBlockEvents(markdown)
  if (blockEvents.length === 0) {
    return { status: 'not-table' }
  }

  const tableEvents = blockEvents.filter(isTableModelEvent)
  if (tableEvents.length !== 1) {
    if (tableEvents.length > 1) {
      console.warn(
        `[${options.operation}] Markdown 同时解析出多个 TableBlock，pending 单块表格路径拒绝猜测消费: tableCount=${tableEvents.length}, blockId=${options.blockId ?? 'unknown'}`
      )
      return {
        status: 'multiple-table-blocks',
        tableCount: tableEvents.length,
      }
    }
    return { status: 'not-table' }
  }

  const surroundingEvents = blockEvents.filter((event) => !isTableModelEvent(event))
  const hasMeaningfulSurroundingEvents = surroundingEvents.some(
    (event) => !isIgnorableBlockEvent(event)
  )
  if (hasMeaningfulSurroundingEvents) {
    console.warn(
      `[${options.operation}] TableBlock 周围存在其他有意义块，pending 单块表格路径拒绝截断消费: totalBlocks=${blockEvents.length}, blockId=${options.blockId ?? 'unknown'}`
    )
    return {
      status: 'mixed-with-meaningful-surroundings',
      totalBlocks: blockEvents.length,
    }
  }

  const [event] = tableEvents
  console.info(
    `[${options.operation}] 命中整表 WASM parse 路径, totalBlocks=${blockEvents.length}, blockId=${options.blockId ?? 'unknown'}`
  )

  return {
    status: 'table',
    model: event.attrs,
  }
}

export async function classifyPendingMarkdownTopLevelBlock(
  markdown: string,
  options: PendingMarkdownRuntimeOptions
): Promise<PendingTopLevelBlockParseResult> {
  if (!markdown) {
    return { status: 'empty' }
  }

  const blockEvents = await parseMarkdownToBlockEvents(markdown)
  if (blockEvents.length === 0) {
    return { status: 'empty' }
  }

  const meaningfulEvents = blockEvents.filter((event) => !isIgnorableBlockEvent(event))
  if (meaningfulEvents.length === 0) {
    return { status: 'empty' }
  }

  if (meaningfulEvents.length !== 1) {
    console.warn(
      `[${options.operation}] Markdown 顶层解析出多个有意义块，pending 单块路径暂不直接消费: totalBlocks=${meaningfulEvents.length}, blockId=${options.blockId ?? 'unknown'}`
    )
    return {
      status: 'multiple-meaningful-blocks',
      totalBlocks: meaningfulEvents.length,
      blockTypes: meaningfulEvents.map((event) => event.block_type),
    }
  }

  const [event] = meaningfulEvents
  if (isTableModelEvent(event)) {
    return {
      status: 'table',
      model: event.attrs,
    }
  }

  const block = mapBlockEventToPendingCanonicalBlock(event)
  if (!block) {
    console.warn(
      `[${options.operation}] Markdown 顶层单块类型暂未接入 pending canonical block 路径: blockType=${event.block_type}, blockId=${options.blockId ?? 'unknown'}`
    )
    return {
      status: 'unsupported-single-block',
      blockType: event.block_type,
    }
  }

  return {
    status: 'single-block',
    block,
  }
}

export async function parsePendingMarkdownToTableModel(
  markdown: string,
  options: PendingMarkdownRuntimeOptions
): Promise<PendingTableModel | null> {
  const result = await classifyPendingMarkdownTable(markdown, options)
  return result.status === 'table' ? result.model : null
}
