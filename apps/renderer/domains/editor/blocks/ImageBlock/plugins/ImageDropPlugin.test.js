import { Schema } from 'prosemirror-model'
import { EditorState, NodeSelection } from 'prosemirror-state'
import { describe, expect, it, vi } from 'vitest'
import {
  createRenderVirtualizationPlugin,
  prepareInitialRenderVirtualizationState,
} from '../../../features/RenderVirtualization/state/renderVirtualizationPlugin'
import { createInsertImageTransaction } from './ImageDropPlugin'

vi.mock('../../../extensions/clipboard/PasteRegistry', () => ({
  PastePriority: { NORMAL: 50 },
}))

vi.mock('../../../extensions/clipboard/PlainTextMarkdownHandler', () => ({
  plainTextMarkdownHandler: { name: 'PlainTextMarkdownHandler' },
}))

const schema = new Schema({
  nodes: {
    doc: { content: 'rootBlock+' },
    text: { group: 'inline' },
    rootBlock: {
      group: 'block',
      attrs: { id: { default: null } },
      content: 'imageBlock+',
      toDOM: (node) => ['div', { 'data-id': node.attrs.id }, 0],
      parseDOM: [{ tag: 'div[data-id]' }],
    },
    imageBlock: {
      group: 'block',
      atom: true,
      selectable: true,
      attrs: {
        id: { default: null },
        src: { default: '' },
        alt: { default: '' },
      },
      toDOM: (node) => ['img', { 'data-block-id': node.attrs.id, src: node.attrs.src }],
      parseDOM: [{ tag: 'img[data-block-id]' }],
    },
  },
})

function createState() {
  const state = EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, [
      schema.nodes.rootBlock.create(
        { id: 'image-root' },
        schema.nodes.imageBlock.create({ id: 'existing-image', src: 'old.png' })
      ),
    ]),
    plugins: [createRenderVirtualizationPlugin()],
  })

  return prepareInitialRenderVirtualizationState(state, {
    enabled: true,
    initialHydratedBlockCount: 0,
  })
}

describe('ImageDropPlugin', () => {
  it('selects the inserted image after creating the insertion transaction', () => {
    let state = createState()
    const imageNode = schema.nodes.imageBlock.create({
      id: 'new-image',
      src: 'data:image/png;base64,test',
      alt: 'new.png',
    })

    state = state.apply(createInsertImageTransaction(state, imageNode, 1))

    expect(state.selection).toBeInstanceOf(NodeSelection)
    expect(state.selection.from).toBe(1)
    expect(state.doc.nodeAt(1)?.attrs.id).toBe('new-image')
  })
})
