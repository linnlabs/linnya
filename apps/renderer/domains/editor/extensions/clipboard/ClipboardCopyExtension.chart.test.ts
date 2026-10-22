// @vitest-environment jsdom
import { Editor, Node } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import StarterKit from '@tiptap/starter-kit'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { admitMarkdownChartSpec, serializeMarkdownChartSpec, type MarkdownChartSpec } from '@app/schemas'

vi.mock('@tiptap/vue-3', () => ({ VueNodeViewRenderer: vi.fn(() => vi.fn()) }))
vi.mock('../../blocks/ChartBlock/ui/ChartBlockView.vue', () => ({ default: {} }))
vi.mock('../../../../shared/services/markdownService', () => ({
  parseMarkdownToBlocksByStreaming: vi.fn(() => { throw new Error('rich HTML must not use Markdown paste') }),
}))

import { BaseBlock } from '../../blocks/BaseBlock'
import { ChartBlock } from '../../blocks/ChartBlock/ChartBlock'
import { ClipboardCopyExtension } from './ClipboardCopyExtension'

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

const TestRootBlock = Node.create({
  name: 'rootBlock',
  content: 'baseBlock|chartBlock',
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

function fixtureSpec(): MarkdownChartSpec {
  const admission = admitMarkdownChartSpec({
    chartType: 'line',
    title: '季度营收',
    categories: ['Q1', 'Q2', 'Q3'],
    series: [{ name: '营收', values: [120, 132.5, 101] }, { name: '成本', values: [80, 90, 85], lineDash: 'dash' }],
    valueAxis: { title: '万元', numberFormat: '#,##0.0' },
  })
  if (!admission.ok) throw new Error('fixture invalid')
  return admission.spec
}

const editors: Editor[] = []

function createEditor(withContent = false) {
  const editor = new Editor({
    extensions: [
      Document.extend({ content: 'rootBlock+' }),
      StarterKit.configure({ document: false, trailingNode: false }),
      TestRootBlock,
      BaseBlock,
      ChartBlock,
      ClipboardCopyExtension,
    ],
    content: withContent
      ? {
          type: 'doc',
          content: [
            { type: 'rootBlock', attrs: { id: 'root-a' }, content: [{ type: 'baseBlock', attrs: { id: 'p-1' }, content: [{ type: 'text', text: '正文' }] }] },
            { type: 'rootBlock', attrs: { id: 'root-b' }, content: [{ type: 'chartBlock', attrs: { id: 'chart-1', blockType: 'chart', spec: fixtureSpec() } }] },
          ],
        }
      : { type: 'doc', content: [{ type: 'rootBlock', attrs: { id: 'root-x' }, content: [{ type: 'baseBlock', attrs: { id: 'p-x' } }] }] },
  })
  editors.push(editor)
  return editor
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.stubGlobal('ClipboardEvent', CopyEvent)
})
afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy())
  vi.unstubAllGlobals()
})

function copyAll(source: Editor): CopyEvent {
  source.commands.selectAll()
  const event = new CopyEvent('copy', { cancelable: true })
  source.view.dom.dispatchEvent(event)
  return event
}

describe('图表块的块复制', () => {
  it('text/plain 是 canonical 的 linnya-chart 围栏，保持 Markdown 往返语义', () => {
    const event = copyAll(createEditor(true))

    expect(event.defaultPrevented).toBe(true)
    const plain = event.clipboardData.getData('text/plain')
    expect(plain).toContain('```linnya-chart\n')
    expect(plain).toContain(serializeMarkdownChartSpec(fixtureSpec()))
    expect(event.clipboardData.getData('text/markdown')).toBe(plain)
  })

  it('text/html 把图表渲染成 figure：带规格、标题和可读的数据表，而不是 JSON 代码', () => {
    const event = copyAll(createEditor(true))
    const parsed = new DOMParser().parseFromString(event.clipboardData.getData('text/html'), 'text/html')

    const figure = parsed.querySelector('figure[data-type="chart-block"]')
    expect(figure?.getAttribute('data-chart-spec')).toBe(serializeMarkdownChartSpec(fixtureSpec()))
    expect(figure?.querySelector('figcaption')?.textContent).toBe('季度营收')
    expect(parsed.querySelector('pre')).toBeNull()

    const header = [...parsed.querySelectorAll('figure thead th')].map(cell => cell.textContent)
    expect(header).toHaveLength(3)
    expect(header.slice(1)).toEqual(['营收', '成本'])
    const firstRow = [...parsed.querySelectorAll('figure tbody tr:first-child > *')].map(cell => cell.textContent)
    expect(firstRow[0]).toBe('Q1')
    expect(firstRow[1]).toContain('120')
  })

  it('粘贴到另一个编辑器：恢复为图表块，规格与原图一致', () => {
    const source = createEditor(true)
    const target = createEditor(false)
    const html = copyAll(source).clipboardData.getData('text/html')

    expect(target.view.pasteHTML(html)).toBe(true)

    const pasted: MarkdownChartSpec[] = []
    target.state.doc.descendants(node => {
      if (node.type.name === 'chartBlock') pasted.push(node.attrs['spec'])
    })
    expect(pasted).toHaveLength(1)
    expect(serializeMarkdownChartSpec(pasted[0]!)).toBe(serializeMarkdownChartSpec(fixtureSpec()))
    expect(target.state.doc.textContent).toContain('正文')
  })

  it('图表被篡改成非法规格的 HTML 粘贴时整批拒绝', () => {
    const target = createEditor(false)
    const html = '<div data-linnya-copy-scope="1"><figure data-type="chart-block" data-chart-spec="{&quot;chartType&quot;:&quot;nope&quot;}"><table><thead><tr><th>x</th></tr></thead></table></figure></div>'

    expect(() => target.view.pasteHTML(html)).toThrow('Invalid linnya-chart')

    let chartCount = 0
    target.state.doc.descendants(node => { if (node.type.name === 'chartBlock') chartCount += 1 })
    expect(chartCount).toBe(0)
    expect(target.state.doc.textContent).not.toContain('x')
  })
})
