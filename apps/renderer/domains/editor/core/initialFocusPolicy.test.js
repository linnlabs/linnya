import { describe, expect, it, afterEach } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'

import {
  countRootBlocksInEditorState,
  findFirstBaseBlockTextSelectionPos,
  focusFirstEditableBlock,
} from './initialFocusPolicy'
import {
  resetEditorShellRuntimeForOwner,
  setLargeDocumentShellMode,
  setLargeDocumentShellModeForOwner,
} from '../ui/services/editorFeatureFlags'

const schema = new Schema({
  nodes: {
    doc: { content: 'rootBlock*' },
    rootBlock: {
      group: 'block',
      content: 'baseBlock',
      toDOM: () => ['div', 0],
      parseDOM: [{ tag: 'div' }],
    },
    baseBlock: {
      group: 'block',
      content: 'text*',
      toDOM: () => ['p', 0],
      parseDOM: [{ tag: 'p' }],
    },
    text: { group: 'inline' },
  },
})

function createState(rootBlockCount) {
  const blocks = Array.from({ length: rootBlockCount }, (_, index) =>
    schema.node('rootBlock', null, [
      schema.node('baseBlock', null, schema.text(`block ${index + 1}`)),
    ])
  )
  return EditorState.create({ doc: schema.node('doc', null, blocks), plugins: [] })
}

function createEditorMock(state) {
  const calls = {
    focus: 0,
    setTextSelection: [],
    run: 0,
  }

  const chain = {
    focus() {
      calls.focus += 1
      return chain
    },
    setTextSelection(pos) {
      calls.setTextSelection.push(pos)
      return chain
    },
    run() {
      calls.run += 1
      return true
    },
  }

  return {
    editor: {
      isDestroyed: false,
      state,
      chain: () => chain,
    },
    calls,
  }
}

afterEach(() => {
  setLargeDocumentShellMode(false)
})

describe('initialFocusPolicy', () => {
  it('finds the first editable baseBlock position for small documents', () => {
    const state = createState(3)

    expect(countRootBlocksInEditorState(state)).toBe(3)
    expect(findFirstBaseBlockTextSelectionPos(state)).toBe(2)
  })

  it('keeps initial focus for small documents as a single chained dispatch', () => {
    const { editor, calls } = createEditorMock(createState(3))

    expect(focusFirstEditableBlock(editor)).toBe(true)
    expect(calls.focus).toBe(1)
    expect(calls.setTextSelection).toEqual([2])
    expect(calls.run).toBe(1)
  })

  it('skips initial focus for large documents', () => {
    const { editor, calls } = createEditorMock(createState(1500))

    expect(focusFirstEditableBlock(editor)).toBe(false)
    expect(calls.focus).toBe(0)
    expect(calls.setTextSelection).toEqual([])
    expect(calls.run).toBe(0)
  })

  it('skips initial focus while RootBlock shell mode is active', () => {
    const { editor, calls } = createEditorMock(createState(1))
    setLargeDocumentShellMode(true)
    setLargeDocumentShellModeForOwner(editor, true)

    expect(focusFirstEditableBlock(editor)).toBe(false)
    expect(calls.focus).toBe(0)
    expect(calls.setTextSelection).toEqual([])
    expect(calls.run).toBe(0)

    resetEditorShellRuntimeForOwner(editor)
  })

  it('uses editor-scoped shell runtime instead of the legacy global active flag', () => {
    setLargeDocumentShellMode(true)
    const { editor, calls } = createEditorMock(createState(1))

    expect(focusFirstEditableBlock(editor)).toBe(true)
    expect(calls.focus).toBe(1)
    expect(calls.setTextSelection).toEqual([2])
    expect(calls.run).toBe(1)
  })
})
