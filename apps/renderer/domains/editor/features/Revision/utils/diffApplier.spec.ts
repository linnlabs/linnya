import { describe, expect, it } from 'vitest'

import { workspaceMarkdownSchemaLite } from 'src/domains/markdown'
import { buildInsertedInlineNodes, buildInsertedNodesForRichSegment } from './diffApplier'

describe('buildInsertedInlineNodes', () => {
  it('keeps plain text as a single text node when there is no newline', () => {
    const bold = workspaceMarkdownSchemaLite.marks.bold.create()

    const nodes = buildInsertedInlineNodes(workspaceMarkdownSchemaLite, 'hello', [bold])

    expect(nodes.map(node => node.toJSON())).toEqual([
      {
        type: 'text',
        text: 'hello',
        marks: [{ type: 'bold' }]
      }
    ])
  })

  it('converts newline characters into hardBreak nodes and preserves marks', () => {
    const bold = workspaceMarkdownSchemaLite.marks.bold.create()

    const nodes = buildInsertedInlineNodes(workspaceMarkdownSchemaLite, '第一行\n第二行', [bold])

    expect(nodes.map(node => node.toJSON())).toEqual([
      {
        type: 'text',
        text: '第一行',
        marks: [{ type: 'bold' }]
      },
      {
        type: 'hardBreak',
        marks: [{ type: 'bold' }]
      },
      {
        type: 'text',
        text: '第二行',
        marks: [{ type: 'bold' }]
      }
    ])
  })

  it('keeps consecutive newlines as consecutive hardBreak nodes', () => {
    const nodes = buildInsertedInlineNodes(workspaceMarkdownSchemaLite, 'a\n\nb')

    expect(nodes.map(node => node.toJSON())).toEqual([
      { type: 'text', text: 'a' },
      { type: 'hardBreak' },
      { type: 'hardBreak' },
      { type: 'text', text: 'b' }
    ])
  })

  it('currently turns multiline code payloads into text + hardBreak nodes', () => {
    const revisionMark = workspaceMarkdownSchemaLite.marks.revisionMark.create({
      revisionId: 'ai-debug',
      changeType: 'insert',
      source: 'ai'
    })

    const nodes = buildInsertedInlineNodes(
      workspaceMarkdownSchemaLite,
      ['# heading', 'def hello_world():', 'print("ok")'].join('\n'),
      [revisionMark]
    )

    expect(nodes.map(node => ({ type: node.type.name, text: node.text ?? null }))).toEqual([
      { type: 'text', text: '# heading' },
      { type: 'hardBreak', text: null },
      { type: 'text', text: 'def hello_world():' },
      { type: 'hardBreak', text: null },
      { type: 'text', text: 'print("ok")' }
    ])
    expect(nodes.every(node => node.marks.some(mark => mark.type.name === 'revisionMark'))).toBe(true)
  })

  it('keeps multiline code payload as literal text when requested', () => {
    const revisionMark = workspaceMarkdownSchemaLite.marks.revisionMark.create({
      revisionId: 'ai-code',
      changeType: 'insert',
      source: 'ai'
    })

    const code = ['# heading', 'def hello_world():', 'print("ok")'].join('\n')
    const nodes = buildInsertedInlineNodes(
      workspaceMarkdownSchemaLite,
      code,
      [revisionMark],
      'literalText'
    )

    expect(nodes.map(node => ({ type: node.type.name, text: node.text ?? null }))).toEqual([
      { type: 'text', text: code }
    ])
    expect(nodes[0]?.marks.some(mark => mark.type.name === 'revisionMark')).toBe(true)
  })

  it('materializes inlineLatex insert segments as inlineLatex nodes', () => {
    const revisionMark = workspaceMarkdownSchemaLite.marks.revisionMark.create({
      revisionId: 'ai-latex',
      changeType: 'insert',
      source: 'ai'
    })

    const nodes = buildInsertedNodesForRichSegment(
      workspaceMarkdownSchemaLite,
      {
        text: '$E=mc^2$',
        inlineAtom: {
          type: 'inlineLatex',
          latexSource: 'E=mc^2',
          textRepresentation: '$E=mc^2$',
          attrs: { latexSource: 'E=mc^2' }
        }
      },
      [revisionMark]
    )

    expect(nodes.map(node => node.toJSON())).toEqual([
      {
        type: 'inlineLatex',
        attrs: expect.objectContaining({
          latexSource: 'E=mc^2'
        }),
        marks: [{ type: 'revisionMark', attrs: expect.any(Object) }]
      }
    ])
  })
})
