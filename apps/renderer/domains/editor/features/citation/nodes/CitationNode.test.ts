// @vitest-environment jsdom

import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Slice } from '@tiptap/pm/model'
import { afterEach, describe, expect, it } from 'vitest'
import { CitationNode } from './CitationNode'
import { remapPastedCitationIdentities } from '../functions/remapPastedCitationIdentities'

describe('CitationNode identity round-trip', () => {
  let editor: Editor | null = null

  afterEach(() => {
    editor?.destroy()
    editor = null
  })

  it('HTML 往返保留来源快照，并把 canonical ref 而非派生编号写入边界文本', () => {
    editor = new Editor({
      extensions: [StarterKit, CitationNode],
      content: `<p>结论<span
        data-type="citation"
        data-citation-id="citation-1"
        data-citation-ref="AB2345"
        data-source-type="knowledge_base"
        data-source-id="doc-1"
        data-kb-id="kb-1"
        data-block-id="block-1"
        data-title="文献标题"
        data-snippet="文献原文"
        data-snippets='["文献原文","补充原文"]'
      >[99]</span></p>`,
    })

    const citation = editor.getJSON().content?.[0]?.content?.[1]
    expect(citation).toMatchObject({
      type: 'citationNode',
      attrs: {
        citationId: 'citation-1',
        ref: 'AB2345',
        sourceId: 'doc-1',
        kbId: 'kb-1',
        blockId: 'block-1',
        snippets: ['文献原文', '补充原文'],
      },
    })

    const rendered = new DOMParser().parseFromString(editor.getHTML(), 'text/html')
    const node = rendered.querySelector<HTMLElement>('span.citation-mark')
    expect(node?.textContent).toBe('[@AB2345]')
    expect(node?.getAttribute('data-citation-ref')).toBe('AB2345')
    expect(node?.getAttribute('data-block-id')).toBe('block-1')
  })

  it('作为 inline atom 占一个文档位置并允许携带 revision mark', () => {
    editor = new Editor({ extensions: [StarterKit, CitationNode] })
    const schema = editor.schema
    const node = schema.nodes.citationNode.create(
      {
        citationId: 'citation-2',
        sourceType: 'manual',
        sourceId: 'manual-1',
        title: '离线来源',
        snippet: '快照',
      },
      null,
      [schema.marks.bold.create()]
    )
    expect(node.nodeSize).toBe(1)
    expect(node.isAtom).toBe(true)
    expect(node.marks.map(mark => mark.type.name)).toEqual(['bold'])
  })

  it('粘贴时只重建引用实例 ID，完整保留稳定来源锚点和原文快照', () => {
    editor = new Editor({ extensions: [StarterKit, CitationNode] })
    const original = editor.schema.node('paragraph', null, [
      editor.schema.nodes.citationNode.create({
        citationId: 'copied-citation-id',
        ref: 'Abc234',
        sourceType: 'knowledge_base',
        sourceId: 'stable-doc-id',
        kbId: 'kb-1',
        blockId: 'stable-block-id',
        title: '来源标题快照',
        snippet: '来源原文快照',
      }),
    ])
    const remapped = remapPastedCitationIdentities(
      new Slice(original.content, 0, 0),
      () => 'new-citation-id'
    )
    const pasted = remapped.content.firstChild

    expect(pasted).toMatchObject({ type: expect.objectContaining({ name: 'citationNode' }) })
    expect(pasted?.attrs).toMatchObject({
      citationId: 'new-citation-id',
      ref: 'Abc234',
      sourceId: 'stable-doc-id',
      kbId: 'kb-1',
      blockId: 'stable-block-id',
      title: '来源标题快照',
      snippet: '来源原文快照',
    })
  })
})
