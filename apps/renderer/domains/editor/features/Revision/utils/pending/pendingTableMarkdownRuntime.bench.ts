/**
 * @file pendingTableMarkdownRuntime.bench.ts
 * @description 表格 pending 解析路径微基准测试。
 *
 * 对比两条路径：
 * - 新路径：整表一次 WASM parse -> TableBlock.attrs -> buildTableRowsFromTableModel()
 * - 旧 fallback：parsePipeTableMarkdown() -> 逐 cell parse -> buildTableRowsFromParsedTable()
 *
 * 运行：
 * npx vitest bench apps/renderer/domains/editor/features/Revision/utils/pending/pendingTableMarkdownRuntime.bench.ts
 */

import { bench, describe } from 'vitest'
import { createRequire } from 'node:module'
import type { Node as ProseMirrorNode } from 'prosemirror-model'

import { workspaceMarkdownSchemaLite } from 'src/domains/markdown'
import {
  buildTableRowsFromTableModel,
} from './pendingRevisionHelpers'
import { parsePipeTableMarkdown } from './pipeTableParser'
import { blockEventsToInlineProjection, buildInlineNodesFromProjection } from '../../../../services/markdownRuntime'
import type { PendingTableModel } from './pendingMarkdownRuntime'
import { attachCitationHydrationToProjection } from './citationHydrationHelper'

type MockEditor = {
  state: {
    schema: typeof workspaceMarkdownSchemaLite
  }
}

type BenchmarkFixture = {
  hydration: Record<
    string,
    {
      docId: string
      blockId: string
      title: string
      snippet: string
      kbId: string
    }
  >
  markdown: string
}

const editor: MockEditor = {
  state: {
    schema: workspaceMarkdownSchemaLite,
  },
}

const originalConsoleInfo = console.info.bind(console)
console.info = (...args: unknown[]) => {
  const first = args[0]
  if (typeof first === 'string' && first.includes('[citationHydrationHelper]')) {
    return
  }
  originalConsoleInfo(...args)
}

const require = createRequire(import.meta.url)
const parserWasmNode = require('../../../../../../../../packages/parser-wasm/pkg-node/parser_wasm.js') as {
  StreamingParser: new () => {
    process_chunk: (chunk: string) => unknown[]
    finalize_parsing: () => unknown[]
  }
}

function buildCellMarkdown(row: number, col: number): string {
  const ref = `r${String(row).padStart(2, '0')}${String(col).padStart(2, '0')}`.slice(0, 6)
  const mode = (row + col) % 5

  if (mode === 0) {
    return `**R${row}C${col}** 普通文本`
  }
  if (mode === 1) {
    return `[访问 R${row}C${col}](https://example.com/${row}/${col})`
  }
  if (mode === 2) {
    return `$x_{${row},${col}}$ + ~~delta~~`
  }
  if (mode === 3) {
    return `引用 [@${ref}] 与 \`code_${row}_${col}\``
  }
  return `混合 **bold** [link](https://example.com/mix/${row}/${col}) [@${ref}]`
}

function buildHydration(rows: number, cols: number) {
  const hydration: BenchmarkFixture['hydration'] = {}
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const ref = `r${String(row).padStart(2, '0')}${String(col).padStart(2, '0')}`.slice(0, 6)
      hydration[ref] = {
        docId: `doc-${ref}`,
        blockId: `block-${ref}`,
        title: `Title ${ref}`,
        snippet: `Snippet ${ref}`,
        kbId: 'kb-bench',
      }
    }
  }
  return hydration
}

function buildTableMarkdown(rows: number, cols: number): BenchmarkFixture {
  const header = Array.from({ length: cols }, (_, col) => `列${col + 1}`)
  const alignment = Array.from({ length: cols }, () => '---')
  const body = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => buildCellMarkdown(row, col))
  )

  const markdown = [
    `| ${header.join(' | ')} |`,
    `| ${alignment.join(' | ')} |`,
    ...body.map((cells) => `| ${cells.join(' | ')} |`),
  ].join('\n')

  return {
    markdown,
    hydration: buildHydration(rows, cols),
  }
}

async function parseMarkdownToBlockEventsByNodeWasm(markdown: string) {
  const parser = new parserWasmNode.StreamingParser()
  const chunkEvents = parser.process_chunk(markdown)
  const finalEvents = parser.finalize_parsing()
  const a = Array.isArray(chunkEvents) ? chunkEvents : []
  const b = Array.isArray(finalEvents) ? finalEvents : []
  return [...a, ...b] as Array<{
    block_type: string
    attrs?: unknown
    structured_content?: unknown
    raw_content_fallback?: string | null
  }>
}

async function parsePendingMarkdownToTableModelByNodeWasm(markdown: string): Promise<PendingTableModel | null> {
  const events = await parseMarkdownToBlockEventsByNodeWasm(markdown)
  if (events.length !== 1) {
    return null
  }

  const [event] = events
  if (event?.block_type !== 'TableBlock' || !event.attrs || typeof event.attrs !== 'object') {
    return null
  }

  return event.attrs as PendingTableModel
}

async function parseCellProjectionByNodeWasm(markdown: string) {
  const events = await parseMarkdownToBlockEventsByNodeWasm(markdown)
  return blockEventsToInlineProjection(events, {
    multiBlockMode: 'first-block',
  })
}

async function buildTableRowsFromParsedTableByNodeWasm(fixture: BenchmarkFixture) {
  const parsed = parsePipeTableMarkdown(fixture.markdown)
  if (!parsed) {
    throw new Error('fallback path failed to parse pipe table markdown')
  }

  const { schema } = editor.state
  const rowType = schema.nodes.tableRow
  const cellType = schema.nodes.tableCell
  const headerCellType = schema.nodes.tableHeader || schema.nodes.tableHeaderCell
  const cellContentType = schema.nodes.tableCellContentBlock

  if (!rowType || !cellType || !headerCellType || !cellContentType) {
    throw new Error('table schema is incomplete for benchmark')
  }

  const defaultColWidth = 150
  const cellAttrs = {
    colwidth: [defaultColWidth],
  }

  const buildCellContentNode = async (cellMarkdown: string) => {
    const projection = await parseCellProjectionByNodeWasm(cellMarkdown)
    const hydratedProjection = attachCitationHydrationToProjection(projection, fixture.hydration)
    const inlineNodes = buildInlineNodesFromProjection(hydratedProjection, schema)
    return cellContentType.create({}, inlineNodes.length > 0 ? inlineNodes : [schema.text('')])
  }

  const rows: ProseMirrorNode[] = []

  if (parsed.headerCells.length > 0) {
    const headerContentNodes = await Promise.all(parsed.headerCells.map(buildCellContentNode))
    rows.push(
      rowType.create(
        null,
        headerContentNodes.map((contentNode) => headerCellType.create(cellAttrs, [contentNode]))
      )
    )
  }

  for (const rowCells of parsed.bodyRows) {
    const contentNodes = await Promise.all(rowCells.map(buildCellContentNode))
    rows.push(
      rowType.create(
        null,
        contentNodes.map((contentNode) => cellType.create(cellAttrs, [contentNode]))
      )
    )
  }

  return rows
}

async function runSingleParsePath(fixture: BenchmarkFixture) {
  const model = await parsePendingMarkdownToTableModelByNodeWasm(fixture.markdown)
  if (!model) {
    throw new Error('single parse path did not produce TableBlock model')
  }

  const result = await buildTableRowsFromTableModel(
    editor as never,
    model,
    fixture.hydration
  )
  if (result.rows.length === 0) {
    throw new Error('single parse path produced empty rows')
  }
}

async function runFallbackPath(fixture: BenchmarkFixture) {
  const rows = await buildTableRowsFromParsedTableByNodeWasm(fixture)
  if (rows.length === 0) {
    throw new Error('fallback path produced empty rows')
  }
}

const smallFixture = buildTableMarkdown(3, 3)
const mediumFixture = buildTableMarkdown(10, 6)
const largeFixture = buildTableMarkdown(30, 10)

describe('小表 3x3', () => {
  bench('整表一次 parse', async () => {
    await runSingleParsePath(smallFixture)
  })

  bench('fallback 逐 cell parse', async () => {
    await runFallbackPath(smallFixture)
  })
})

describe('中表 10x6', () => {
  bench('整表一次 parse', async () => {
    await runSingleParsePath(mediumFixture)
  })

  bench('fallback 逐 cell parse', async () => {
    await runFallbackPath(mediumFixture)
  })
})

describe('大表 30x10', () => {
  bench('整表一次 parse', async () => {
    await runSingleParsePath(largeFixture)
  })

  bench('fallback 逐 cell parse', async () => {
    await runFallbackPath(largeFixture)
  })
})
