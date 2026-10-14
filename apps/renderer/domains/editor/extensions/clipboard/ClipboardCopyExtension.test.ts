// @vitest-environment jsdom
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { CitationNode } from '../../features/citation/nodes/CitationNode'
import { BaseBlock } from '../../blocks/BaseBlock'
import { ClipboardCopyExtension } from './ClipboardCopyExtension'
import { plainTextMarkdownHandler } from './PlainTextMarkdownHandler'

vi.mock('../../../../shared/services/markdownService', () => ({
  parseMarkdownToBlocksByStreaming: vi.fn(() => { throw new Error('rich HTML must not use Markdown paste') }),
}))

class CopyEvent extends Event {
  readonly values = new Map<string, string>()
  readonly clipboardData = {
    setData: (type: string, value: string) => this.values.set(type, value),
    getData: (type: string) => this.values.get(type) ?? '',
    clearData: () => this.values.clear(),
    types: ['text/plain', 'text/html', 'text/markdown'],
    files: [],
  }
}

const editors: Editor[] = []
beforeEach(() => setActivePinia(createPinia()))
afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy())
  vi.unstubAllGlobals()
})

function createEditor() {
  const editor = new Editor({
    extensions: [
      Document.extend({ content: 'baseBlock+' }),
      StarterKit.configure({ document: false, trailingNode: false }),
      BaseBlock, CitationNode, ClipboardCopyExtension,
    ],
  })
  editors.push(editor)
  return editor
}

describe('block copy → portable HTML → another editor paste', () => {
  it('保留只含 Citation span 的富 HTML，不让纯文本 Markdown 抢先丢弃快照', () => {
    const target = createEditor()
    const event = new CopyEvent('paste')
    event.values.set('text/plain', '**文字** [@Abc234]')
    event.values.set('text/html', '<p>文字<span data-type="citation" data-citation-id="one">[@Abc234]</span></p>')
    expect(plainTextMarkdownHandler.canHandle(event, { selection: target.state.selection })).toBe(false)
  })

  it.each(['copy', 'cut'])('%s preserves 12 source snapshots, marks and plain text; paste only renews occurrence IDs', action => {
    vi.stubGlobal('ClipboardEvent', CopyEvent)
    const source = createEditor()
    const target = createEditor()
    const citations = Array.from({ length: 12 }, (_, index) => source.schema.nodes.citationNode.create({
      citationId: `source-occurrence-${index}`,
      ref: `Abc23${'456789ABCDEF'[index]}`,
      sourceType: index % 2 ? 'knowledge_base' : 'web',
      sourceId: index % 2 ? `document-${index}` : `https://example.com/source/${index}`,
      kbId: index % 2 ? 'knowledge-1' : null,
      blockId: index % 2 ? `block-${index}` : null,
      url: index % 2 ? null : `https://example.com/source/${index}`,
      title: `Source ${index} <literal>`,
      snippet: `Snapshot ${index} "quoted" & original`,
      snippets: [`Excerpt ${index}`, `Second ${index}`],
      authors: ['Author A', 'Author B'],
      date: '2025-03-01',
      containerTitle: 'Synthetic report',
    }, null, [source.schema.marks.bold.create()]))
    source.commands.setContent(source.schema.node('doc', null, [source.schema.nodes.baseBlock.create(null, [
      source.schema.text('正文 '), ...citations, source.schema.text(' 字面量 [@Abc234]'),
    ])]))
    source.commands.selectAll()
    const event = new CopyEvent(action, { cancelable: true })
    source.view.dom.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    const html = event.clipboardData.getData('text/html')
    expect(new DOMParser().parseFromString(html, 'text/html').querySelectorAll('[data-type="citation"]')).toHaveLength(12)
    expect(event.clipboardData.getData('text/plain')).toContain('[@Abc234]')
    expect(event.clipboardData.getData('text/plain')).not.toContain('LINNYACITATION')
    expect(plainTextMarkdownHandler.canHandle(event, { selection: target.state.selection })).toBe(false)
    expect(target.view.pasteHTML(html)).toBe(true)

    const pasted: typeof citations = []
    target.state.doc.descendants(node => { if (node.type.name === 'citationNode') pasted.push(node) })
    expect(pasted).toHaveLength(12)
    pasted.forEach((node, index) => {
      const { citationId: originalId, ...snapshot } = citations[index].attrs
      const { citationId, ...pastedSnapshot } = node.attrs
      expect(pastedSnapshot).toEqual(snapshot)
      expect(citationId).not.toBe(originalId)
      expect(node.marks.map(mark => mark.type.name)).toEqual(['bold'])
    })
    expect(new Set(pasted.map(node => node.attrs.citationId)).size).toBe(12)
    expect(target.state.doc.textContent).toContain('字面量 [@Abc234]')
    if (action === 'cut') expect(source.state.doc.textContent).toBe('')
    else expect(source.state.doc.textContent).toContain('正文')
  })
})
