/**
 * TableBlock 专属菜单 Provider：块菜单里的“表格样式”。
 *
 * 样式是整张表的呈现事实（table 节点的 tableStyle），一次选择是一条可撤销事务；
 * 只在可编辑、且这张表没有未决修订时出现（未决修订期间块内容由数据库修订拥有）。
 */

import { onNextFrame } from '@linnya/renderer-ui'
import { CheckmarkIcon } from '@linnya/renderer-ui/icons'
import {
  readWorkspaceTableStyle,
  WORKSPACE_TABLE_STYLES,
  type WorkspaceTableStyle,
} from '@linnya/markdown-document-core/workspace-table'
import type { EditorMessageKey } from '../../../definitions/editorMessages'
import type { BlockMenuContext, BlockMenuProvider, MenuItem } from '../../../features/blockActionMenu/types'
import { useRevisionStore } from '../../../features/Revision/useRevisionStore'
import { getBlockPosIndex } from '../../../extensions/position/blockPosIndex'
import { resolveCurrentEditorMessage } from '../../../functions/resolveCurrentEditorMessage'
import { TABLE_STYLE_SWATCHES } from './tableStyleSwatches'

const STYLE_LABELS: Readonly<Record<WorkspaceTableStyle, EditorMessageKey>> = {
  default: 'editor.tableBlock.style.default',
  'three-line': 'editor.tableBlock.style.threeLine',
  'column-rules': 'editor.tableBlock.style.columnRules',
  grid: 'editor.tableBlock.style.grid',
  banded: 'editor.tableBlock.style.banded',
  'accent-header': 'editor.tableBlock.style.accentHeader',
}

/**
 * 块菜单以块柄为触发元素，选完后 CustomSelect 先把焦点还给块柄（setTimeout 0 + nextTick）；
 * 下一帧再把焦点交回正文（Tiptap 的 focus 命令自己再推迟一帧），撤销与继续输入才作用于编辑器。
 * 与 TableStructureChrome 的 returnFocusToEditor 同一做法。
 */
function returnFocusToEditor(editor: BlockMenuContext['editor']): void {
  onNextFrame(() => {
    if (!editor.isDestroyed) editor.commands.focus(undefined, { scrollIntoView: false })
  })
}

/** 按 rootBlock ID 在当前文档里重新定位（与 PositionUtils.findRootBlockById 同一索引），菜单打开后文档变化也不会改到别处。 */
function findRootBlock(ctx: BlockMenuContext, rootBlockId: string): { node: BlockMenuContext['rootBlockNode']; pos: number } | null {
  const doc = ctx.editor.state.doc
  const pos = getBlockPosIndex(doc).get(rootBlockId)
  if (pos === undefined) return null
  const node = doc.nodeAt(pos)
  return node?.type.name === 'rootBlock' ? { node, pos } : null
}

export function setTableStyle(ctx: BlockMenuContext, style: WorkspaceTableStyle): boolean {
  const rootBlockId: unknown = ctx.rootBlockNode.attrs['id']
  if (typeof rootBlockId !== 'string') return false
  const rootBlock = findRootBlock(ctx, rootBlockId)
  const table = rootBlock?.node.firstChild
  if (!rootBlock || table?.type.name !== 'table') return false
  returnFocusToEditor(ctx.editor)
  if (readWorkspaceTableStyle(table.attrs['tableStyle']) === style) return false
  const tablePos = rootBlock.pos + 1
  return ctx.editor.chain()
    .command(({ tr }) => {
      tr.setNodeMarkup(tablePos, undefined, { ...table.attrs, tableStyle: style })
      return true
    })
    .run()
}

export const tableBlockMenuProvider: BlockMenuProvider = {
  name: 'table-block-actions',
  weight: 110,

  getItems: ctx => {
    if (!ctx.editor.isEditable) return []
    const rootBlockId: unknown = ctx.rootBlockNode.attrs['id']
    if (typeof rootBlockId === 'string' && useRevisionStore(ctx.editor).hasCanonicalPending(rootBlockId)) return []
    const current = readWorkspaceTableStyle(ctx.contentBlockNode.attrs['tableStyle'])
    const styles: MenuItem[] = WORKSPACE_TABLE_STYLES.map(style => ({
      id: `table-style-${style}`,
      label: resolveCurrentEditorMessage(STYLE_LABELS[style]),
      iconComponent: TABLE_STYLE_SWATCHES[style],
      iconClassName: 'table-style-swatch',
      className: 'table-style-option',
      selected: style === current,
      rightIconComponent: style === current ? CheckmarkIcon : undefined,
      action: menuContext => { setTableStyle(menuContext, style) },
    }))
    return [
      { id: 'separator-table-1', type: 'separator', label: '' },
      { id: 'table-style', label: resolveCurrentEditorMessage('editor.tableBlock.style.menu'), children: styles },
    ]
  },
}
