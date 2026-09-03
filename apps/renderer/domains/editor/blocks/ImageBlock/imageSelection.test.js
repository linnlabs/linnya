import { Schema } from 'prosemirror-model'
import { EditorState, NodeSelection } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { selectInsertedImageNode } from './imageSelection'

const schema = new Schema({
  nodes: {
    doc: { content: 'imageBlock*' },
    imageBlock: {
      group: 'block',
      atom: true,
      selectable: true,
      attrs: { id: { default: null } },
      toDOM: (node) => ['img', { 'data-block-id': node.attrs.id }],
      parseDOM: [{ tag: 'img[data-block-id]' }],
    },
    text: { group: 'inline' },
  },
})

describe('imageSelection', () => {
  it('selects an image inserted through replaceSelectionWith', () => {
    const state = EditorState.create({
      schema,
      doc: schema.nodes.doc.create(null, [
        schema.nodes.imageBlock.create({ id: 'old-image' }),
      ]),
    })
    const imageNode = schema.nodes.imageBlock.create({ id: 'new-image' })
    const insertFrom = state.selection.from
    const tr = state.tr.replaceSelectionWith(imageNode)

    const selected = selectInsertedImageNode(tr, insertFrom)

    expect(selected).toBe(true)
    expect(tr.selection).toBeInstanceOf(NodeSelection)
    expect(tr.selection.from).toBe(0)
    expect(tr.doc.nodeAt(0)?.attrs.id).toBe('new-image')
  })

  it('returns false when the mapped insertion position is not an imageBlock', () => {
    const emptyState = EditorState.create({ schema })
    const tr = emptyState.tr

    expect(selectInsertedImageNode(tr, 0)).toBe(false)
  })
})
