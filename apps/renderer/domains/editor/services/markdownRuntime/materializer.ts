import type { Node as ProseMirrorNode, Schema } from 'prosemirror-model'
import {
  admitMarkdownAnnotationComment,
  isMarkdownEmptyBlockAnnotationAnchorComment,
  MarkdownAnnotationsSchema,
} from '@app/schemas'

import {
  generateannotationId,
  generateBlockId,
  generateRootBlockId,
} from '../../../../shared/utils/idUtils'
import type { BlockEventLike, ContentFragmentLike } from './types'
import type { MarkdownInlineProjection } from './types'
import {
  buildInlineNodesFromProjection,
  structuredContentToInlineProjection,
} from './inlineProjection'

function normalizeBlockTypeName(blockType: string): string {
  return String(blockType || '').trim()
}

function isPlainObject(obj: unknown): obj is Record<string, unknown> {
  return typeof obj === 'object' && obj !== null && !Array.isArray(obj)
}

export interface TableRowsMaterializationOptions {
  hydrateProjection?: (projection: MarkdownInlineProjection) => MarkdownInlineProjection
  defaultColWidth?: number
  createCellContentAttrs?: () => Record<string, unknown> | undefined
}

export interface TableInlineProjectionGridModel {
  withHeaderRow: boolean
  header: MarkdownInlineProjection[]
  rows: MarkdownInlineProjection[][]
}

export function buildTableRowsFromInlineProjectionGrid(
  model: TableInlineProjectionGridModel,
  schema: Schema,
  options: TableRowsMaterializationOptions = {}
): ProseMirrorNode[] | null {
  const rowType = schema.nodes.tableRow
  const headerCellType = schema.nodes.tableHeader
  const cellType = schema.nodes.tableCell
  const cellContentType = schema.nodes.tableCellContentBlock

  if (!rowType || !headerCellType || !cellType || !cellContentType) {
    return null
  }

  const cellAttrs = {
    colwidth: [options.defaultColWidth ?? 150],
  }

  const buildCellContentBlock = (projection: MarkdownInlineProjection): ProseMirrorNode | null => {
    const finalProjection = options.hydrateProjection
      ? options.hydrateProjection(projection)
      : projection
    const inline = buildInlineNodesFromProjection(finalProjection, schema)

    try {
      return cellContentType.create(
        options.createCellContentAttrs?.() ?? { id: generateBlockId(), blockType: 'tableCellContent' },
        inline ?? undefined
      )
    } catch {
      try {
        return cellContentType.create({}, inline ?? undefined)
      } catch {
        return null
      }
    }
  }

  const rowNodes: ProseMirrorNode[] = []

  if (model.withHeaderRow && model.header.length > 0) {
    const headerCells: ProseMirrorNode[] = []
    for (const projection of model.header) {
      const contentBlock = buildCellContentBlock(projection)
      if (contentBlock) {
        headerCells.push(headerCellType.create(cellAttrs, [contentBlock]))
      }
    }
    if (headerCells.length > 0) {
      rowNodes.push(rowType.create({}, headerCells))
    }
  }

  for (const row of model.rows) {
    const cells: ProseMirrorNode[] = []
    for (const projection of row) {
      const contentBlock = buildCellContentBlock(projection)
      if (contentBlock) {
        cells.push(cellType.create(cellAttrs, [contentBlock]))
      }
    }

    if (cells.length > 0) {
      rowNodes.push(rowType.create({}, cells))
    }
  }

  return rowNodes.length > 0 ? rowNodes : null
}

export function buildTableRowsFromTableModel(
  model: Record<string, unknown>,
  schema: Schema,
  options: TableRowsMaterializationOptions = {}
): ProseMirrorNode[] | null {
  const projectionGrid: TableInlineProjectionGridModel = {
    withHeaderRow: model.with_header_row === true,
    header: Array.isArray(model.header)
      ? model.header
          .filter(isPlainObject)
          .map((cell) =>
            structuredContentToInlineProjection(
              Array.isArray(cell.content) ? (cell.content as ContentFragmentLike[]) : null,
              null
            )
          )
      : [],
    rows: Array.isArray(model.rows)
      ? model.rows
          .filter(isPlainObject)
          .map((row) =>
            Array.isArray(row.cells)
              ? row.cells
                  .filter(isPlainObject)
                  .map((cell) =>
                    structuredContentToInlineProjection(
                      Array.isArray(cell.content) ? (cell.content as ContentFragmentLike[]) : null,
                      null
                    )
                  )
              : []
          )
      : [],
  }

  return buildTableRowsFromInlineProjectionGrid(projectionGrid, schema, options)
}

function buildRootBlock(inner: ProseMirrorNode, schema: Schema): ProseMirrorNode | null {
  const rootType = schema.nodes.rootBlock
  if (!rootType) {
    return null
  }

  try {
    return rootType.create({ id: generateRootBlockId() }, inner)
  } catch {
    return null
  }
}

function buildInlineNodesFromBlockEvent(
  event: BlockEventLike,
  schema: Schema
): ProseMirrorNode[] | null {
  const projection = structuredContentToInlineProjection(
    Array.isArray(event.structured_content)
      ? (event.structured_content as ContentFragmentLike[])
      : null,
    typeof event.raw_content_fallback === 'string' ? event.raw_content_fallback : null
  )

  return buildInlineNodesFromProjection(projection, schema)
}

export function blockEventsToDocJson(
  blockEvents: BlockEventLike[],
  schema: Schema
): { type: 'doc'; content: unknown[] } | null {
  if (!Array.isArray(blockEvents) || blockEvents.length === 0) {
    return null
  }

  const rootBlocks: unknown[] = []

  for (const event of blockEvents) {
    const typeName = normalizeBlockTypeName(event.block_type)
    const rawFallback =
      typeof event.raw_content_fallback === 'string' ? event.raw_content_fallback : null

    if (typeName === 'HtmlComment') {
      if (rawFallback && isMarkdownEmptyBlockAnnotationAnchorComment(rawFallback)) {
        const baseBlockType = schema.nodes.baseBlock
        if (!baseBlockType) {
          throw new Error('[MarkdownImport] 当前 Schema 不支持空 BaseBlock 批注锚点')
        }
        const root = buildRootBlock(
          baseBlockType.create({ id: generateBlockId(), blockType: 'base' }),
          schema
        )
        if (!root) {
          throw new Error('[MarkdownImport] 无法创建空 BaseBlock 批注锚点')
        }
        rootBlocks.push(root.toJSON())
        continue
      }
      const target = rootBlocks[rootBlocks.length - 1]
      if (!isPlainObject(target)) {
        throw new Error('[MarkdownImport] Annotation comment 前没有可绑定的目标块')
      }
      if (!rawFallback) {
        throw new Error('[MarkdownImport] HtmlComment 缺少原始内容')
      }
      const targetAttrs = isPlainObject(target.attrs) ? target.attrs : {}
      const previousAnnotations = MarkdownAnnotationsSchema.parse(targetAttrs.annotations ?? [])
      target.attrs = {
        ...targetAttrs,
        annotations: [
          ...previousAnnotations,
          admitMarkdownAnnotationComment(rawFallback, {
            id: generateannotationId(),
            author: 'User',
            timestamp: new Date().toISOString(),
            meta: { source: 'manual' },
          }),
        ],
      }
      continue
    }

    if (typeName === 'TableBlock') {
      const tableType = schema.nodes.table
      if (tableType && isPlainObject(event.attrs)) {
        const rows = buildTableRowsFromTableModel(event.attrs, schema)
        if (rows && rows.length > 0) {
          const tableNode = tableType.create(
            { id: generateBlockId(), blockType: 'table' },
            rows
          )
          const root = buildRootBlock(tableNode, schema)
          if (root) {
            rootBlocks.push(root.toJSON())
            continue
          }
        }
      }
    }

    if (typeName === 'LatexBlock') {
      const latexType = schema.nodes.latexBlock
      if (latexType) {
        const latexNode = latexType.create({
          id: generateBlockId(),
          blockType: 'latex',
          latexSource: rawFallback ?? '',
        })
        const root = buildRootBlock(latexNode, schema)
        if (root) {
          rootBlocks.push(root.toJSON())
          continue
        }
      }
    }

    if (typeName === 'HorizontalRuleBlock') {
      const hrType = schema.nodes.horizontalRuleBlock
      if (hrType) {
        const hrNode = hrType.create({
          id: generateBlockId(),
          blockType: 'horizontalRule',
        })
        const root = buildRootBlock(hrNode, schema)
        if (root) {
          rootBlocks.push(root.toJSON())
          continue
        }
      }
    }

    if (typeName === 'CodeBlock') {
      const codeType = schema.nodes.codeBlock
      if (codeType) {
        const codeNode = codeType.create(
          {
            id: generateBlockId(),
            blockType: 'code',
            language: typeof event.language === 'string' ? event.language : '',
          },
          rawFallback ? schema.text(rawFallback) : undefined
        )
        const root = buildRootBlock(codeNode, schema)
        if (root) {
          rootBlocks.push(root.toJSON())
          continue
        }
      }
    }

    const inline = buildInlineNodesFromBlockEvent(event, schema)

    if (typeName === 'HeadingBlock') {
      const headingType = schema.nodes.headingBlock
      if (headingType) {
        const node = headingType.create(
          {
            id: generateBlockId(),
            blockType: 'heading',
            level: typeof event.level === 'number' && event.level > 0 ? event.level : 1,
          },
          inline ?? undefined
        )
        const root = buildRootBlock(node, schema)
        if (root) {
          rootBlocks.push(root.toJSON())
          continue
        }
      }
    }

    if (typeName === 'QuoteBlock') {
      const quoteType = schema.nodes.quoteBlock
      if (quoteType) {
        const node = quoteType.create(
          { id: generateBlockId(), blockType: 'quote' },
          inline ?? undefined
        )
        const root = buildRootBlock(node, schema)
        if (root) {
          rootBlocks.push(root.toJSON())
          continue
        }
      }
    }

    if (typeName === 'ListItemBlock') {
      const listItemType = schema.nodes.listItemBlock
      if (listItemType) {
        const listType = typeof event.list_type === 'string' ? event.list_type : 'bullet'
        // 前瞻兼容：未来 WASM 若在 ordered 列表的首项上携带 start
        // （可能字段：event.list_start、event.start、event.attrs.start），自动读取。
        // 当前 WASM 不发，则为 null（行为完全等同今天）。
        let start: number | null = null
        if (listType === 'ordered') {
          const candidate =
            (event as { list_start?: unknown }).list_start ??
            (event as { start?: unknown }).start ??
            (event.attrs && typeof event.attrs === 'object'
              ? (event.attrs as { start?: unknown }).start
              : undefined)
          if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
            start = Math.floor(candidate)
          } else if (typeof candidate === 'string') {
            const parsed = parseInt(candidate, 10)
            if (Number.isFinite(parsed) && parsed > 0) start = parsed
          }
        }
        const node = listItemType.create(
          {
            id: generateBlockId(),
            blockType: 'listItem',
            listType,
            level:
              typeof event.list_level === 'number'
                ? event.list_level
                : typeof event.level === 'number'
                  ? event.level
                  : 0,
            start,
          },
          inline ?? undefined
        )
        const root = buildRootBlock(node, schema)
        if (root) {
          rootBlocks.push(root.toJSON())
          continue
        }
      }
    }

    const baseType = schema.nodes.baseBlock
    if (baseType) {
      const node = baseType.create(
        { id: generateBlockId(), blockType: 'base' },
        inline ?? undefined
      )
      const root = buildRootBlock(node, schema)
      if (root) {
        rootBlocks.push(root.toJSON())
      }
    }
  }

  return rootBlocks.length > 0 ? { type: 'doc', content: rootBlocks } : null
}

export function blockEventToRootBlockNode(
  blockEvent: BlockEventLike,
  schema: Schema
): ProseMirrorNode | null {
  const docJson = blockEventsToDocJson([blockEvent], schema)
  const rootBlockJson = Array.isArray(docJson?.content) ? docJson.content[0] : null

  if (!rootBlockJson) {
    return null
  }

  try {
    return schema.nodeFromJSON(rootBlockJson as Record<string, unknown>)
  } catch {
    return null
  }
}
