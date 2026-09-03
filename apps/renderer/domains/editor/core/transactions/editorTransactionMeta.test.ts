import { Schema } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import {
  EDITOR_EPHEMERAL_TRANSACTION_META,
  getPendingRevisionProjectionTransactionMeta,
  markCitationDerivationTransaction,
  markPendingRevisionProjectionTransaction,
  markRenderVirtualizationTransaction,
} from './editorTransactionMeta'

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph*' },
    text: { group: 'inline' },
    paragraph: {
      content: 'text*',
      toDOM: () => ['p', 0],
      parseDOM: [{ tag: 'p' }],
    },
  },
})

function createTransaction() {
  const state = EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, schema.text('hello')),
    ]),
  })

  return state.tr
}

describe('editorTransactionMeta', () => {
  it('marks pending projection transactions as ephemeral and history-free', () => {
    const tr = markPendingRevisionProjectionTransaction(createTransaction())

    expect(tr.getMeta('pendingRevisionApply')).toBe(true)
    expect(tr.getMeta('addToHistory')).toBe(false)
    expect(tr.getMeta(EDITOR_EPHEMERAL_TRANSACTION_META)).toBe('pending-revision-projection')
  })

  it('returns the plain meta payload used by direct transaction dispatchers', () => {
    expect(getPendingRevisionProjectionTransactionMeta()).toEqual({
      pendingRevisionApply: true,
      addToHistory: false,
      [EDITOR_EPHEMERAL_TRANSACTION_META]: 'pending-revision-projection',
    })
  })

  it('marks render virtualization transactions as ephemeral and history-free', () => {
    const tr = markRenderVirtualizationTransaction(createTransaction())

    expect(tr.getMeta('addToHistory')).toBe(false)
    expect(tr.getMeta(EDITOR_EPHEMERAL_TRANSACTION_META)).toBe('render-virtualization')
  })

  it('marks citation derivation transactions without entering undo history', () => {
    const tr = markCitationDerivationTransaction(createTransaction())

    expect(tr.getMeta('forceCitationDerivation')).toBe(true)
    expect(tr.getMeta('addToHistory')).toBe(false)
    expect(tr.getMeta(EDITOR_EPHEMERAL_TRANSACTION_META)).toBe('citation-derivation')
  })
})
