// @vitest-environment jsdom
import { Editor, Node } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import StarterKit from '@tiptap/starter-kit'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  parseMarkdownToBlocksByStreaming: vi.fn(),
  confirm: vi.fn(),
}))

vi.mock('@tiptap/vue-3', () => ({ VueNodeViewRenderer: vi.fn(() => vi.fn()) }))
vi.mock('../../blocks/ChartBlock/ui/ChartBlockView.vue', () => ({ default: {} }))
vi.mock('../../blocks/CodeBlock/ui/CodeBlockView.vue', () => ({ default: {} }))
vi.mock('../../../../shared/services/markdownService', () => ({
  parseMarkdownToBlocksByStreaming: mocks.parseMarkdownToBlocksByStreaming,
}))
vi.mock('@shared/composables/confirmDialog', () => ({ confirm: mocks.confirm }))

import { getLowlight } from '../../core/lowlight'
import { BaseBlock } from '../../blocks/BaseBlock'
import { ChartBlock } from '../../blocks/ChartBlock/ChartBlock'
import { CodeBlock } from '../../blocks/CodeBlock/CodeBlock'
import { RevisionMark } from '../revision/RevisionMark'
import { plainTextMarkdownHandler } from './PlainTextMarkdownHandler'

const TestRootBlock = Node.create({
  name: 'rootBlock',
  content: 'baseBlock|chartBlock|codeBlock',
  addAttributes() {
    return { id: { default: null } }
  },
  parseHTML() {
    return [{ tag: 'div[data-root-block]' }]
  },
  renderHTML() {
    return ['div', { 'data-root-block': '' }, 0]
  },
})

const validChart = {
  block_type: 'CodeBlock',
  language: 'linnya-chart',
  raw_content_fallback: JSON.stringify({ chartType: 'bar', categories: ['A', 'B'], series: [{ name: 'S', values: [1, 2] }] }),
}
const invalidChart = { block_type: 'CodeBlock', language: 'linnya-chart', raw_content_fallback: '{"chartType": "nope"}' }
const paragraph = (text: string) => ({
  block_type: 'BaseBlock',
  structured_content: [{ type: 'text', text, marks: [] }],
  raw_content_fallback: text,
})

const editors: Editor[] = []

function createEditor() {
  const editor = new Editor({
    extensions: [
      Document.extend({ content: 'rootBlock+' }),
      StarterKit.configure({ document: false, trailingNode: false, codeBlock: false }),
      TestRootBlock,
      BaseBlock,
      RevisionMark,
      CodeBlock.configure({ lowlight: getLowlight() }),
      ChartBlock,
    ],
    content: { type: 'doc', content: [{ type: 'rootBlock', attrs: { id: 'root-1' }, content: [{ type: 'baseBlock', attrs: { id: 'block-1' } }] }] },
  })
  editors.push(editor)
  editor.commands.focus('start')
  return editor
}

async function paste(editor: Editor, events: unknown[]) {
  mocks.parseMarkdownToBlocksByStreaming.mockResolvedValue(events)
  const event = {
    clipboardData: { types: ['text/plain'], getData: () => '```linnya-chart\n...\n```' },
    preventDefault: vi.fn(),
  }
  return plainTextMarkdownHandler.handle(event, { view: editor.view, editor })
}

function rootKinds(editor: Editor): string[] {
  const kinds: string[] = []
  editor.state.doc.forEach(root => {
    const inner = root.firstChild
    kinds.push(inner?.type.name === 'codeBlock' ? `code:${String(inner.attrs['language'])}` : inner?.type.name ?? '')
  })
  return kinds
}

beforeEach(() => {
  setActivePinia(createPinia())
  mocks.parseMarkdownToBlocksByStreaming.mockReset()
  mocks.confirm.mockReset()
})
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()))

describe('粘贴含 linnya-chart 围栏的 Markdown 文本', () => {
  it('合法图表直接成为图表块，不弹确认', async () => {
    const editor = createEditor()

    expect(await paste(editor, [paragraph('前文'), validChart])).toBe(true)

    expect(rootKinds(editor)).toContain('chartBlock')
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it('存在无效图表时先询问；取消则文档保持原样，其余内容也不落地', async () => {
    const editor = createEditor()
    const before = editor.state.doc.toJSON()
    mocks.confirm.mockResolvedValue(false)

    expect(await paste(editor, [paragraph('前文'), validChart, invalidChart])).toBe(true)

    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    const options = mocks.confirm.mock.calls[0]![0]
    expect(options.sections[0].items[0]).toMatch(/^#2 /)
    expect(editor.state.doc.toJSON()).toEqual(before)
  })

  it('用户选择“作为普通代码插入”：无效围栏存为 json 代码，合法图表仍是图表块', async () => {
    const editor = createEditor()
    mocks.confirm.mockResolvedValue(true)

    expect(await paste(editor, [validChart, invalidChart])).toBe(true)

    const kinds = rootKinds(editor)
    expect(kinds).toContain('chartBlock')
    expect(kinds).toContain('code:json')
    expect(kinds).not.toContain('code:linnya-chart')
    expect(editor.state.doc.textContent).toContain('"chartType": "nope"')
  })
})
