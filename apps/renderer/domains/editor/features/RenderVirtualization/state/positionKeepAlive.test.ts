// @vitest-environment jsdom

import type { Editor } from '@tiptap/core'
import { Schema, type Node as ProseMirrorNode } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'
import { describe, expect, it, vi } from 'vitest'
import {
  dispatchPositionRenderVirtualizationKeepAlive,
  findRootBlockIdAtDocumentPosition,
} from './positionKeepAlive'
import { RENDER_VIRTUALIZATION_KEEP_ALIVE_EVENT } from './keepAliveEvents'

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

interface TestEditor extends Pick<Editor, 'state'> {}

interface TestDocContext {
  editor: TestEditor
  positions: {
    rootBlock: number
    table: number
    tableCell: number
    text: number
    rootBlockEnd: number
  }
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

function createTestDocContext(): TestDocContext {
  const cellText = schema.text('cell')
  const tableCell = schema.nodes.tableCell.create(null, cellText)
  const tableRow = schema.nodes.tableRow.create(null, [tableCell])
  const table = schema.nodes.table.create(null, [tableRow])
  const rootBlock = schema.nodes.rootBlock.create({ id: 'root-table' }, table)
  const doc = schema.nodes.doc.create(null, [rootBlock])
  const editor: TestEditor = {
    state: EditorState.create({ schema, doc }),
  }

  const rootBlockPos = findRequiredNodePosition(doc, 'rootBlock')

  return {
    editor,
    positions: {
      rootBlock: rootBlockPos,
      table: findRequiredNodePosition(doc, 'table'),
      tableCell: findRequiredNodePosition(doc, 'tableCell'),
      text: findRequiredNodePosition(doc, 'tableCell') + 1,
      rootBlockEnd: rootBlockPos + rootBlock.nodeSize,
    },
  }
}

describe('positionKeepAlive', () => {
  it('resolves rootBlock id from table and cell positions', () => {
    const { editor, positions } = createTestDocContext()

    expect(findRootBlockIdAtDocumentPosition(editor, positions.rootBlock)).toBe('root-table')
    expect(findRootBlockIdAtDocumentPosition(editor, positions.table)).toBe('root-table')
    expect(findRootBlockIdAtDocumentPosition(editor, positions.tableCell)).toBe('root-table')
    expect(findRootBlockIdAtDocumentPosition(editor, positions.text)).toBe('root-table')
  })

  it('handles a position at the end boundary of the rootBlock', () => {
    const { editor, positions } = createTestDocContext()

    expect(findRootBlockIdAtDocumentPosition(editor, positions.rootBlockEnd)).toBe('root-table')
  })

  it('dispatches a bubbling keep-alive event for position based floating UI', () => {
    const { editor, positions } = createTestDocContext()
    const target = document.createElement('div')
    const listener = vi.fn()
    document.body.appendChild(target)
    document.body.addEventListener(RENDER_VIRTUALIZATION_KEEP_ALIVE_EVENT, listener)

    try {
      dispatchPositionRenderVirtualizationKeepAlive({
        target,
        editor,
        pos: positions.table,
        reason: 'interaction-open',
        active: true,
      })
    } finally {
      document.body.removeEventListener(RENDER_VIRTUALIZATION_KEEP_ALIVE_EVENT, listener)
      target.remove()
    }

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].detail).toEqual({
      blockId: 'root-table',
      reason: 'interaction-open',
      active: true,
    })
  })

  it('uses an explicit keep-alive port for position based floating UI when provided', () => {
    const { editor, positions } = createTestDocContext()
    const acquire = vi.fn(() => true)
    const release = vi.fn(() => true)

    dispatchPositionRenderVirtualizationKeepAlive({
      target: null,
      editor,
      pos: positions.table,
      reason: 'interaction-open',
      active: false,
      keepAlivePort: {
        acquire,
        release,
        releaseReason: () => [],
        hasReason: () => false,
      },
    })

    expect(acquire).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledWith({
      blockId: 'root-table',
      reason: 'interaction-open',
    })
  })
})
