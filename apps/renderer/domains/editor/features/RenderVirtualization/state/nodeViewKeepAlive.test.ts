// @vitest-environment jsdom

import { Schema } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'
import { describe, expect, it, vi } from 'vitest'
import {
  dispatchNodeViewRenderVirtualizationKeepAlive,
  findRootBlockIdForNodeView,
} from './nodeViewKeepAlive'
import { RENDER_VIRTUALIZATION_KEEP_ALIVE_EVENT } from './keepAliveEvents'

type NodeViewKeepAliveEditor = NonNullable<Parameters<typeof findRootBlockIdForNodeView>[0]>

const schema = new Schema({
  nodes: {
    doc: { content: 'rootBlock+' },
    text: { group: 'inline' },
    rootBlock: {
      group: 'block',
      attrs: { id: { default: null } },
      content: 'imageBlock',
      toDOM: (node) => ['div', { 'data-id': node.attrs.id }, 0],
      parseDOM: [{ tag: 'div[data-id]' }],
    },
    imageBlock: {
      group: 'block',
      atom: true,
      attrs: { id: { default: null } },
      toDOM: (node) => ['img', { 'data-block-id': node.attrs.id }],
      parseDOM: [{ tag: 'img[data-block-id]' }],
    },
  },
})

function createEditor(): NodeViewKeepAliveEditor {
  return {
    state: EditorState.create({
      schema,
      doc: schema.nodes.doc.create(null, [
        schema.nodes.rootBlock.create(
          { id: 'root-a' },
          schema.nodes.imageBlock.create({ id: 'image-a' })
        ),
      ]),
    }),
  }
}

describe('nodeViewKeepAlive', () => {
  it('resolves the containing rootBlock id from a NodeView getPos', () => {
    const editor = createEditor()

    expect(findRootBlockIdForNodeView(editor, () => 1)).toBe('root-a')
  })

  it('dispatches a bubbling keep-alive event for NodeView floating interactions', () => {
    const editor = createEditor()
    const target = document.createElement('div')
    const listener = vi.fn()
    document.body.appendChild(target)
    document.body.addEventListener(RENDER_VIRTUALIZATION_KEEP_ALIVE_EVENT, listener)

    try {
      dispatchNodeViewRenderVirtualizationKeepAlive({
        target,
        editor,
        getPos: () => 1,
        reason: 'interaction-open',
        active: true,
      })
    } finally {
      document.body.removeEventListener(RENDER_VIRTUALIZATION_KEEP_ALIVE_EVENT, listener)
      target.remove()
    }

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].detail).toEqual({
      blockId: 'root-a',
      reason: 'interaction-open',
      active: true,
    })
  })

  it('uses an explicit keep-alive port when provided', () => {
    const editor = createEditor()
    const acquire = vi.fn(() => true)
    const release = vi.fn(() => true)

    dispatchNodeViewRenderVirtualizationKeepAlive({
      target: null,
      editor,
      getPos: () => 1,
      reason: 'interaction-open',
      active: true,
      keepAlivePort: {
        acquire,
        release,
        releaseReason: () => [],
        hasReason: () => false,
      },
    })

    expect(acquire).toHaveBeenCalledWith({
      blockId: 'root-a',
      reason: 'interaction-open',
    })
    expect(release).not.toHaveBeenCalled()
  })
})
