/**
 * @file chartBlockTransactions.ts
 * @description 把当前内容块转换成图表块的事务构造：纯函数，不派发、不读写 store。
 *
 * 转换与 LaTeX 块一致：保留外层 rootBlock 与内容块身份，只替换内容块本身；位于文档末尾时
 * 补一个空段落，保证图表之后还能继续书写。表格内不允许转换（图表块不是单元格内容）。
 */

import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { NodeSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import type { MarkdownChartSpec } from '@app/schemas'
import { generateBlockId, generateRootBlockId } from '../../../../../shared/utils/idUtils'
import { NODE_GROUPS } from '../../../extensions/core/schema'

const CONTENT_BLOCK_NAMES: ReadonlySet<string> = new Set(NODE_GROUPS.BLOCK_CONTENT.split('|'))

export interface ChartConversionIds {
  readonly chartId?: string
  readonly trailingRootId?: string
  readonly trailingBlockId?: string
}

export type ChartConversionResult =
  | { readonly kind: 'converted'; readonly transaction: Transaction; readonly chartId: string }
  | { readonly kind: 'in-table' }
  | { readonly kind: 'no-block' }

interface LocatedContentBlock {
  readonly pos: number
  readonly node: ProseMirrorNode
}

function isContentBlock(node: ProseMirrorNode): boolean {
  return CONTENT_BLOCK_NAMES.has(node.type.name)
}

function locateContentBlock(state: EditorState): LocatedContentBlock | 'in-table' | null {
  const { selection } = state
  const { $from } = selection

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === 'table') return 'in-table'
  }

  if (selection instanceof NodeSelection) {
    // 选中的是 rootBlock 内的内容块（图片、公式等）。
    if (isContentBlock(selection.node) && $from.parent.type.name === 'rootBlock') {
      return { pos: selection.from, node: selection.node }
    }
  }

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (isContentBlock(node) && $from.node(depth - 1).type.name === 'rootBlock') {
      return { pos: $from.before(depth), node }
    }
  }
  return null
}

export function buildConvertToChartTransaction(
  state: EditorState,
  spec: MarkdownChartSpec,
  ids: ChartConversionIds = {},
): ChartConversionResult {
  const located = locateContentBlock(state)
  if (located === 'in-table') return { kind: 'in-table' }
  if (located === null) return { kind: 'no-block' }

  const { schema } = state
  const chartType = schema.nodes['chartBlock']
  if (!chartType) return { kind: 'no-block' }

  const currentId: unknown = located.node.attrs['id']
  const chartId = ids.chartId ?? (typeof currentId === 'string' && currentId !== '' ? currentId : generateBlockId())
  const chart = chartType.create({ id: chartId, blockType: 'chart', spec })

  const transaction = state.tr.replaceWith(located.pos, located.pos + located.node.nodeSize, chart)

  const $chart = transaction.doc.resolve(located.pos)
  const rootBlockEnd = $chart.after($chart.depth)
  const rootBlockType = schema.nodes['rootBlock']
  const baseBlockType = schema.nodes['baseBlock']
  if (rootBlockEnd === transaction.doc.content.size && rootBlockType && baseBlockType) {
    const trailing = rootBlockType.create(
      { id: ids.trailingRootId ?? generateRootBlockId() },
      baseBlockType.create({ id: ids.trailingBlockId ?? generateBlockId() }),
    )
    transaction.insert(rootBlockEnd, trailing)
  }

  transaction.setSelection(NodeSelection.create(transaction.doc, located.pos)).scrollIntoView()
  return { kind: 'converted', transaction, chartId }
}
