// @vitest-environment jsdom

import { Schema, type Node as ProseMirrorNode } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { nextTick, ref, shallowRef } from 'vue'
import {
  RENDER_VIRTUALIZATION_KEEP_ALIVE_EVENT,
  type RenderVirtualizationKeepAliveEventDetail,
} from '../../../../features/RenderVirtualization/state/keepAliveEvents'
import {
  useTableRenderVirtualizationKeepAlive,
  type TableVirtualizationEditor,
} from './useTableRenderVirtualizationKeepAlive'

const schema = new Schema({
  nodes: {
    doc: { content: 'rootBlock+' },
    text: { group: 'inline' },
    rootBlock: {
      group: 'block',
      attrs: { id: { default: null } },
      content: 'table',
      toDOM: (node) => ['div', { 'data-id': node.attrs.id }, 0],
      parseDOM: [{ tag: 'div[data-id]' }],
    },
    table: {
      group: 'block',
      content: 'tableRow+',
      tableRole: 'table',
      toDOM: () => ['table', ['tbody', 0]],
      parseDOM: [{ tag: 'table' }],
    },
    tableRow: {
      content: 'tableCell+',
      tableRole: 'row',
      toDOM: () => ['tr', 0],
      parseDOM: [{ tag: 'tr' }],
    },
    tableCell: {
      content: 'text*',
      tableRole: 'cell',
      toDOM: () => ['td', 0],
      parseDOM: [{ tag: 'td' }],
    },
  },
})

interface RecordedKeepAliveEvent extends RenderVirtualizationKeepAliveEventDetail {
  targetName: string
}

interface TestEditorContext {
  editor: TableVirtualizationEditor
  tablePos: number
}

function findRequiredNodePosition(doc: ProseMirrorNode, nodeName: string): number {
  let foundPos: number | null = null

  doc.descendants((node, pos) => {
    if (node.type.name !== nodeName || foundPos !== null) return true
    foundPos = pos
    return false
  })

  if (foundPos === null) {
    throw new Error(`测试文档缺少节点: ${nodeName}`)
  }

  return foundPos
}

function recordKeepAliveEvents(target: HTMLElement, targetName: string, records: RecordedKeepAliveEvent[]): void {
  target.addEventListener(RENDER_VIRTUALIZATION_KEEP_ALIVE_EVENT, (event) => {
    if (!(event instanceof CustomEvent)) return
    records.push({
      ...(event.detail as RenderVirtualizationKeepAliveEventDetail),
      targetName,
    })
  })
}

function createEditorContext(rootBlockId: string, dom: HTMLElement): TestEditorContext {
  const tableCell = schema.nodes.tableCell.create(null, schema.text('cell'))
  const tableRow = schema.nodes.tableRow.create(null, [tableCell])
  const table = schema.nodes.table.create(null, [tableRow])
  const rootBlock = schema.nodes.rootBlock.create({ id: rootBlockId }, table)
  const doc = schema.nodes.doc.create(null, [rootBlock])

  return {
    editor: {
      isDestroyed: false,
      state: EditorState.create({ schema, doc }),
      view: { dom },
    },
    tablePos: findRequiredNodePosition(doc, 'table'),
  }
}

describe('useTableRenderVirtualizationKeepAlive', () => {
  it('pins the rootBlock containing the active table position and releases it when cleared', async () => {
    const records: RecordedKeepAliveEvent[] = []
    const editorDom = document.createElement('div')
    recordKeepAliveEvents(editorDom, 'editor-a', records)

    const context = createEditorContext('root-table-a', editorDom)
    const editor = shallowRef<TableVirtualizationEditor | null>(context.editor)
    const activePos = ref<number | null>(null)

    useTableRenderVirtualizationKeepAlive({ editor, activePos })
    expect(records).toEqual([])

    activePos.value = context.tablePos
    await nextTick()

    activePos.value = null
    await nextTick()

    expect(records).toEqual([
      { blockId: 'root-table-a', reason: 'interaction-open', active: true, targetName: 'editor-a' },
      { blockId: 'root-table-a', reason: 'interaction-open', active: false, targetName: 'editor-a' },
    ])
  })

  it('releases the previous editor DOM before pinning through the next editor DOM', async () => {
    const records: RecordedKeepAliveEvent[] = []
    const editorDomA = document.createElement('div')
    const editorDomB = document.createElement('div')
    recordKeepAliveEvents(editorDomA, 'editor-a', records)
    recordKeepAliveEvents(editorDomB, 'editor-b', records)

    const contextA = createEditorContext('root-table-a', editorDomA)
    const contextB = createEditorContext('root-table-b', editorDomB)
    const editor = shallowRef<TableVirtualizationEditor | null>(contextA.editor)
    const activePos = ref<number | null>(contextA.tablePos)

    useTableRenderVirtualizationKeepAlive({ editor, activePos })
    await nextTick()

    editor.value = contextB.editor
    activePos.value = contextB.tablePos
    await nextTick()

    expect(records).toEqual([
      { blockId: 'root-table-a', reason: 'interaction-open', active: true, targetName: 'editor-a' },
      { blockId: 'root-table-a', reason: 'interaction-open', active: false, targetName: 'editor-a' },
      { blockId: 'root-table-b', reason: 'interaction-open', active: true, targetName: 'editor-b' },
    ])
  })

  it('uses a custom keep-alive reason for long-lived table AI mode', async () => {
    const records: RecordedKeepAliveEvent[] = []
    const editorDom = document.createElement('div')
    recordKeepAliveEvents(editorDom, 'editor-a', records)

    const context = createEditorContext('root-table-ai', editorDom)
    const editor = shallowRef<TableVirtualizationEditor | null>(context.editor)
    const activePos = ref<number | null>(context.tablePos)

    useTableRenderVirtualizationKeepAlive({ editor, activePos, reason: 'table-ai' })
    await nextTick()

    activePos.value = null
    await nextTick()

    expect(records).toEqual([
      { blockId: 'root-table-ai', reason: 'table-ai', active: true, targetName: 'editor-a' },
      { blockId: 'root-table-ai', reason: 'table-ai', active: false, targetName: 'editor-a' },
    ])
  })

  it('prefers an explicit rootBlock id when the saved table position drifted', async () => {
    const records: RecordedKeepAliveEvent[] = []
    const editorDom = document.createElement('div')
    recordKeepAliveEvents(editorDom, 'editor-a', records)

    const context = createEditorContext('root-table-current', editorDom)
    const editor = shallowRef<TableVirtualizationEditor | null>(context.editor)
    const activePos = ref<number | null>(9999)
    const activeBlockId = ref<string | null>('root-table-current')

    useTableRenderVirtualizationKeepAlive({ editor, activePos, activeBlockId })
    await nextTick()

    activeBlockId.value = null
    await nextTick()

    expect(records).toEqual([
      { blockId: 'root-table-current', reason: 'interaction-open', active: true, targetName: 'editor-a' },
      { blockId: 'root-table-current', reason: 'interaction-open', active: false, targetName: 'editor-a' },
    ])
  })
})
