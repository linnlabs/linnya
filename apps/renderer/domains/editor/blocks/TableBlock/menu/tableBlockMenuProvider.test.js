// @vitest-environment jsdom
import { Editor, Node } from '@tiptap/core'
import { TableRow } from '@tiptap/extension-table'
import StarterKit from '@tiptap/starter-kit'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const pendingRootIds = vi.hoisted(() => new Set())
vi.mock('../../../features/Revision/useRevisionStore', () => ({
  useRevisionStore: () => ({ hasCanonicalPending: id => pendingRootIds.has(id) }),
}))

import { TableBlock } from '../TableBlock'
import { CustomTableCell, CustomTableHeader } from '../TableCell'
import { TableCellContentBlock } from '../TableCellContentBlock'
import { setTableStyle, tableBlockMenuProvider } from './tableBlockMenuProvider'

const TestDocument = Node.create({ name: 'doc', topNode: true, content: 'rootBlock+' })
const TestRootBlock = Node.create({
  name: 'rootBlock',
  content: 'table',
  addAttributes() {
    return { id: { default: null, parseHTML: element => element.getAttribute('data-block-id'), renderHTML: attributes => ({ 'data-block-id': attributes.id }) } }
  },
  parseHTML() {
    return [{ tag: 'div[data-root-block]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', { 'data-root-block': '', ...HTMLAttributes }, 0]
  },
})

const text = value => ({ type: 'text', text: value })
const cell = (type, value) => ({ type, content: [{ type: 'tableCellContentBlock', content: [text(value)] }] })
const tableRoot = (id, attrs = {}) => ({
  type: 'rootBlock',
  attrs: { id },
  content: [{ type: 'table', attrs: { id: `${id}-table`, ...attrs }, content: [
    { type: 'tableRow', content: [cell('tableHeader', '产品线'), cell('tableHeader', '营收')] },
    { type: 'tableRow', content: [cell('tableCell', '桌面端'), cell('tableCell', '1,284.6')] },
  ] }],
})

let editor

function createEditor(content, editable = true) {
  return new Editor({
    element: document.body.appendChild(document.createElement('div')),
    editable,
    extensions: editorExtensions(),
    content: { type: 'doc', content },
  })
}

function context(rootId) {
  let found = null
  editor.state.doc.forEach((rootBlockNode, rootBlockPos) => {
    if (rootBlockNode.attrs.id !== rootId) return
    const contentBlockNode = rootBlockNode.firstChild
    found = { editor, rootBlockNode, rootBlockPos, contentBlockNode, contentBlockPos: rootBlockPos + 1, contentBlockType: contentBlockNode.type.name }
  })
  if (!found) throw new Error(`missing root ${rootId}`)
  return found
}

async function menuItems(rootId) {
  return tableBlockMenuProvider.getItems(context(rootId))
}

const tableStyleOf = rootId => context(rootId).contentBlockNode.attrs.tableStyle
const tableElement = () => editor.view.dom.querySelector('table')

beforeEach(() => {
  setActivePinia(createPinia())
  pendingRootIds.clear()
})
afterEach(() => {
  editor?.destroy()
  document.body.replaceChildren()
})

describe('表格块菜单：表格样式', () => {
  it('列出六种样式，当前样式带选中标记与对勾', async () => {
    editor = createEditor([tableRoot('root', { tableStyle: 'banded' })])
    const items = await menuItems('root')
    const submenu = items.find(item => item.id === 'table-style')
    expect(submenu?.label).toBe('表格样式')
    expect(submenu?.children?.map(item => item.id)).toEqual([
      'table-style-default', 'table-style-three-line', 'table-style-column-rules',
      'table-style-grid', 'table-style-banded', 'table-style-accent-header',
    ])
    const selected = submenu.children.filter(item => item.selected)
    expect(selected.map(item => item.id)).toEqual(['table-style-banded'])
    expect(selected[0]?.rightIconComponent).toBeDefined()
    expect(submenu.children.every(item => item.iconComponent)).toBe(true)
  })

  it('只读或这张表有未决修订时不出现', async () => {
    editor = createEditor([tableRoot('root')], false)
    expect(await menuItems('root')).toEqual([])
    editor.destroy()
    editor = createEditor([tableRoot('root')])
    pendingRootIds.add('root')
    expect(await menuItems('root')).toEqual([])
  })

  it('选中写入一条可撤销事务，表格元素与导出 HTML 同步样式属性', async () => {
    editor = createEditor([tableRoot('root')])
    expect(tableStyleOf('root')).toBe('default')
    expect(tableElement()?.hasAttribute('data-table-style')).toBe(false)
    expect(editor.getHTML()).not.toContain('data-table-style')

    // jsdom 没有布局，ProseMirror 聚焦时读 getClientRects 会抛错，这里只核对调用时机。
    const viewFocus = vi.spyOn(editor.view, 'focus').mockImplementation(() => undefined)
    expect(setTableStyle(context('root'), 'three-line')).toBe(true)
    expect(tableStyleOf('root')).toBe('three-line')
    expect(tableElement()?.getAttribute('data-table-style')).toBe('three-line')
    expect(editor.getHTML()).toContain('data-table-style="three-line"')

    // 菜单关闭会把焦点还给块柄；下一帧交回正文，撤销才落在编辑器上。
    expect(viewFocus).not.toHaveBeenCalled()
    const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve))
    await nextFrame()
    await nextFrame() // Tiptap 的 focus 命令自己再推迟一帧
    expect(viewFocus).toHaveBeenCalled()

    expect(setTableStyle(context('root'), 'three-line')).toBe(false)
    editor.commands.undo()
    expect(tableStyleOf('root')).toBe('default')
    expect(tableElement()?.hasAttribute('data-table-style')).toBe(false)
  })

  it('复制出的 HTML 读回同一样式', () => {
    editor = createEditor([tableRoot('root', { tableStyle: 'grid' })])
    const html = editor.getHTML()
    editor.destroy()
    editor = new Editor({
      element: document.body.appendChild(document.createElement('div')),
      extensions: editorExtensions(),
      content: html,
    })
    expect(editor.state.doc.firstChild?.firstChild?.attrs.tableStyle).toBe('grid')
  })
})

function editorExtensions() {
  return [
    StarterKit.configure({ document: false, trailingNode: false, codeBlock: false }),
    TestDocument,
    TestRootBlock,
    TableBlock.configure({ resizable: true, cellContent: 'tableCellContentBlock', lastColumnResizable: true, firstColumnResizable: false, cellMinWidth: 50 }),
    TableRow,
    CustomTableHeader.configure({ content: 'tableCellContentBlock+' }),
    CustomTableCell.configure({ content: 'tableCellContentBlock+' }),
    TableCellContentBlock,
  ]
}
