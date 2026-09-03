import { describe, expect, it } from 'vitest'
import { Schema } from 'prosemirror-model'
import { collectRootBlockIdsFromDoc } from './collectRootBlockIds'

const schema = new Schema({
  nodes: {
    doc: { content: 'rootBlock*' },
    rootBlock: {
      group: 'block',
      content: 'paragraph',
      attrs: { id: {} },
      toDOM: (node) => ['div', { 'data-id': node.attrs.id }, 0],
      parseDOM: [{ tag: 'div' }],
    },
    paragraph: {
      group: 'block',
      content: 'text*',
      toDOM: () => ['p', 0],
      parseDOM: [{ tag: 'p' }],
    },
    text: { group: 'inline' },
  },
})

describe('collectRootBlockIdsFromDoc', () => {
  it('collects root block ids in document order with an optional limit', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.rootBlock.create({ id: 'root-a' }, schema.nodes.paragraph.create()),
      schema.nodes.rootBlock.create({ id: 'root-b' }, schema.nodes.paragraph.create()),
      schema.nodes.rootBlock.create({ id: 'root-c' }, schema.nodes.paragraph.create()),
    ])

    expect(collectRootBlockIdsFromDoc(doc)).toEqual(['root-a', 'root-b', 'root-c'])
    expect(collectRootBlockIdsFromDoc(doc, { limit: 2 })).toEqual(['root-a', 'root-b'])
  })

  it('reuses the same root block order snapshot while the doc identity is unchanged', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.rootBlock.create({ id: 'root-a' }, schema.nodes.paragraph.create()),
      schema.nodes.rootBlock.create({ id: 'root-b' }, schema.nodes.paragraph.create()),
    ])

    const first = collectRootBlockIdsFromDoc(doc)
    const second = collectRootBlockIdsFromDoc(doc)
    const limited = collectRootBlockIdsFromDoc(doc, { limit: 1 })

    expect(second).toBe(first)
    expect(limited).toEqual(['root-a'])
    expect(limited).not.toBe(first)
  })
})
