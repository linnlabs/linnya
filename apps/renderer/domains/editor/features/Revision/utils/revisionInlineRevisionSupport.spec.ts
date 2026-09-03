import { describe, expect, it } from 'vitest'
import { Schema } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'

import { acceptAllRevisionsInBlock, rejectAllRevisionsInBlock } from '../../../extensions/core/commands/RevisionCommands.js'
import { scanBlockForRevisions, hasRevisionMarksInBlock } from '../store/revisionMarkScan'
import { markWholeBlockAsInsert } from './pending/pendingRevisionHelpers'
import { clearBlockRevisionMarks } from './diffApplier'
import { stripWorkspacePendingFromJSON } from './stripPendingFromJSON'

const schema = new Schema({
  nodes: {
    doc: {
      content: 'rootBlock*',
    },
    rootBlock: {
      content: 'baseBlock',
      attrs: {
        id: { default: null },
      },
    },
    baseBlock: {
      group: 'block',
      content: 'inline*',
    },
    text: {
      group: 'inline',
    },
    hardBreak: {
      inline: true,
      group: 'inline',
      selectable: false,
    },
    inlineLatex: {
      inline: true,
      group: 'inline',
      atom: true,
      attrs: {
        latexSource: { default: '' },
      },
    },
  },
  marks: {
    revisionMark: {
      attrs: {
        revisionId: { default: null },
        changeType: { default: 'insert' },
        source: { default: 'ai' },
      },
      inclusive: false,
    },
    bold: {},
  },
})

function createRevisionMark(changeType: 'insert' | 'delete', revisionId = 'rev-1') {
  return schema.marks.revisionMark.create({
    revisionId,
    changeType,
    source: 'ai',
  })
}

function createRootBlock(inlineContent: any[], blockId = 'block-1') {
  return schema.node('rootBlock', { id: blockId }, [schema.node('baseBlock', null, inlineContent)])
}

function createDoc(inlineContent: any[], blockId = 'block-1') {
  return schema.node('doc', null, [createRootBlock(inlineContent, blockId)])
}

function createMockEditor(docNode = createDoc([])) {
  let state = EditorState.create({
    schema,
    doc: docNode,
  })

  const editor: any = {
    state,
    view: {
      dispatch(tr: any) {
        state = state.apply(tr)
        editor.state = state
      },
    },
  }

  return editor
}

function runCommand(command: ReturnType<typeof acceptAllRevisionsInBlock>, state: EditorState) {
  let nextState = state
  const dispatchedTransactions: unknown[] = []
  const result = command({
    state,
    tr: state.tr,
    dispatch(tr) {
      dispatchedTransactions.push(tr)
      nextState = nextState.apply(tr)
    },
  } as any)

  return {
    result,
    state: nextState,
    dispatchedTransactions,
  }
}

describe('revision inline support', () => {
  it('marks and scans hardBreak / inlineLatex as revision units', () => {
    const editor = createMockEditor(
      createDoc([
        schema.text('A'),
        schema.node('hardBreak'),
        schema.node('inlineLatex', { latexSource: 'x+y' }),
      ])
    )

    const diffStats = markWholeBlockAsInsert(editor, 0, 'rev-1')

    expect(diffStats).toEqual({ insertCount: 3, deleteCount: 0 })

    const contentJson = editor.state.doc.toJSON().content?.[0]?.content?.[0]?.content
    expect(contentJson).toEqual([
      {
        type: 'text',
        text: 'A',
        marks: [{ type: 'revisionMark', attrs: { revisionId: 'rev-1', changeType: 'insert', source: 'ai' } }],
      },
      {
        type: 'hardBreak',
        marks: [{ type: 'revisionMark', attrs: { revisionId: 'rev-1', changeType: 'insert', source: 'ai' } }],
      },
      {
        type: 'inlineLatex',
        attrs: { latexSource: 'x+y' },
        marks: [{ type: 'revisionMark', attrs: { revisionId: 'rev-1', changeType: 'insert', source: 'ai' } }],
      },
    ])

    expect(scanBlockForRevisions(editor, 0)).toEqual({
      revisionId: 'rev-1',
      diffStats: { insertCount: 3, deleteCount: 0 },
    })
    expect(hasRevisionMarksInBlock(editor, 0, 'rev-1')).toBe(true)
  })

  it('accepts whole-block delete when the block only contains delete-marked inline atoms', () => {
    const deleteMark = createRevisionMark('delete')
    const state = EditorState.create({
      schema,
      doc: createDoc([schema.node('inlineLatex', { latexSource: 'z^2' }, null, [deleteMark])]),
    })

    const command = acceptAllRevisionsInBlock(0, 'rev-1')
    const result = runCommand(command, state)

    expect(result.result).toBe(true)
    expect(result.state.doc.childCount).toBe(0)
  })

  it('rejects inserted hardBreak / inlineLatex nodes by deleting those inline atoms', () => {
    const insertMark = createRevisionMark('insert')
    const state = EditorState.create({
      schema,
      doc: createDoc([
        schema.text('keep'),
        schema.node('hardBreak', null, null, [insertMark]),
        schema.node('inlineLatex', { latexSource: 'x+y' }, null, [insertMark]),
      ]),
    })

    const command = rejectAllRevisionsInBlock(0, 'rev-1')
    const result = runCommand(command, state)

    expect(result.result).toBe(true)
    expect(result.state.doc.toJSON()).toEqual(createDoc([schema.text('keep')]).toJSON())
  })

  it('clears revision marks from non-text inline nodes without removing the nodes', () => {
    const insertMark = createRevisionMark('insert')
    const editor = createMockEditor(
      createDoc([
        schema.text('keep'),
        schema.node('hardBreak', null, null, [insertMark]),
        schema.node('inlineLatex', { latexSource: 'x+y' }, null, [insertMark]),
      ])
    )

    expect(clearBlockRevisionMarks(editor, 0, 'rev-1')).toBe(true)

    expect(editor.state.doc.toJSON()).toEqual(
      createDoc([
        schema.text('keep'),
        schema.node('hardBreak'),
        schema.node('inlineLatex', { latexSource: 'x+y' }),
      ]).toJSON()
    )
  })

  it('strips pending revision marks from non-text inline nodes during JSON serialization', () => {
    const docJson = {
      type: 'doc',
      content: [
        {
          type: 'rootBlock',
          attrs: { id: 'block-1' },
          content: [
            {
              type: 'baseBlock',
              content: [
                { type: 'text', text: 'keep' },
                {
                  type: 'hardBreak',
                  marks: [
                    {
                      type: 'revisionMark',
                      attrs: { revisionId: 'rev-1', changeType: 'delete', source: 'ai' },
                    },
                  ],
                },
                {
                  type: 'inlineLatex',
                  attrs: { latexSource: 'x+y' },
                  marks: [
                    {
                      type: 'revisionMark',
                      attrs: { revisionId: 'rev-1', changeType: 'insert', source: 'ai' },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }

    expect(stripWorkspacePendingFromJSON(docJson, {} as any)).toEqual({
      type: 'doc',
      content: [
        {
          type: 'rootBlock',
          attrs: { id: 'block-1' },
          content: [
            {
              type: 'baseBlock',
              content: [
                { type: 'text', text: 'keep' },
                { type: 'hardBreak' },
              ],
            },
          ],
        },
      ],
    })
  })
})
