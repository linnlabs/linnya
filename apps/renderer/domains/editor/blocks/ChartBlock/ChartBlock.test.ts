// @vitest-environment jsdom
import { Editor, Node } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import StarterKit from '@tiptap/starter-kit'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { admitMarkdownChartSpec, serializeMarkdownChartSpec, type MarkdownChartSpec } from '@app/schemas'

const pasteDecision = vi.hoisted(() => vi.fn())
vi.mock('../../features/chart-editing/orchestration/confirmInvalidChartPaste', () => ({ confirmInvalidChartPaste: pasteDecision }))

vi.mock('@tiptap/vue-3', () => ({ VueNodeViewRenderer: vi.fn(() => vi.fn()) }))
vi.mock('./ui/ChartBlockView.vue', () => ({ default: {} }))
vi.mock('../CodeBlock/ui/CodeBlockView.vue', () => ({ default: {} }))

import { getLowlight } from '../../core/lowlight'
import { RevisionMark } from '../../extensions/revision/RevisionMark'
import { BaseBlock } from '../BaseBlock'
import { CodeBlock } from '../CodeBlock/CodeBlock'
import { CodeBlockMarkdownInputRules } from '../CodeBlock/CodeBlockMarkdownInputRules'
import { useChartEditingStore } from '../../features/chart-editing'
import { DEFAULT_CHART_READING_STATE } from '../../features/chart-reading/definitions/chartReadingState'
import { useChartReadingStore } from '../../features/chart-reading/store/chartReadingStore'
import { ChartBlock } from './ChartBlock'
import { handleChartHtmlPaste } from '../../extensions/clipboard/orchestration/handleChartHtmlPaste'
import { findMatchesInDoc, createFindReplacePlugin, searchCommand, replaceAllCommand, replaceCurrentCommand } from '../../features/FindReplace/plugin/findReplacePlugin'
import { syncRenderVirtualizationHeightEstimates, getRenderVirtualizationBlockHeight, getRenderVirtualizationBlockHeightCacheSnapshot } from '../../features/RenderVirtualization/state/blockHeightCacheRegistry'

/** 最小的 rootBlock：只验证 ChartBlock 与外层容器、基础块的协作。 */
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

function spec(value = 1): MarkdownChartSpec {
  const admission = admitMarkdownChartSpec({
    chartType: 'bar',
    title: '销量',
    categories: ['A', 'B'],
    series: [{ name: 'S', values: [value, 2] }],
  })
  if (!admission.ok) throw new Error('fixture invalid')
  return admission.spec
}

const editors: Editor[] = []

function createEditor(content?: unknown) {
  const editor = new Editor({
    extensions: [
      Document.extend({ content: 'rootBlock+' }),
      StarterKit.configure({ document: false, trailingNode: false, codeBlock: false }),
      TestRootBlock,
      BaseBlock,
      RevisionMark,
      CodeBlock.configure({ lowlight: getLowlight() }),
      CodeBlockMarkdownInputRules,
      ChartBlock,
    ],
    content: content ?? {
      type: 'doc',
      content: [{ type: 'rootBlock', attrs: { id: 'root-1' }, content: [{ type: 'baseBlock', attrs: { id: 'block-1' } }] }],
    },
  })
  editors.push(editor)
  return editor
}

function chartDoc(id: string, value = 1) {
  return {
    type: 'doc',
    content: [
      { type: 'rootBlock', attrs: { id: `root-${id}` }, content: [{ type: 'chartBlock', attrs: { id, blockType: 'chart', spec: spec(value) } }] },
      { type: 'rootBlock', attrs: { id: 'root-tail' }, content: [{ type: 'baseBlock', attrs: { id: 'tail' } }] },
    ],
  }
}

beforeEach(() => { setActivePinia(createPinia()); vi.stubGlobal('ClipboardEvent', Event) })
afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy())
  vi.unstubAllGlobals()
})

describe('HTML 往返', () => {
  it('渲染 figure 并带 canonical 规格；解析回同一份规格与 id', () => {
    const source = createEditor(chartDoc('chart-1'))
    const html = source.getHTML()

    const figure = new DOMParser().parseFromString(html, 'text/html').querySelector('figure[data-type="chart-block"]')
    expect(figure?.getAttribute('data-id')).toBe('chart-1')
    expect(figure?.getAttribute('data-chart-spec')).toBe(serializeMarkdownChartSpec(spec()))
    expect(figure?.querySelector('figcaption')?.textContent).toBe('销量')

    const target = createEditor()
    target.commands.setContent(`<div data-root-block>${figure?.outerHTML}</div>`)
    const chart = target.state.doc.firstChild?.firstChild
    expect(chart?.type.name).toBe('chartBlock')
    expect(chart?.attrs['id']).toBe('chart-1')
    expect(chart?.attrs['spec']).toEqual(spec())
  })

  it('规格无效的 figure 拒绝整次解析，保留原文档', () => {
    const target = createEditor()
    const before = target.state.doc
    expect(() => target.commands.setContent('<p>不能部分插入</p><figure data-type="chart-block" data-chart-spec="{bad json"><figcaption>坏图</figcaption></figure>')).toThrow('Invalid linnya-chart')
    expect(target.state.doc).toBe(before)
  })
})

describe('图表围栏不会变成普通代码', () => {
  const validJson = JSON.stringify({ chartType: 'bar', categories: ['A', 'B'], series: [{ name: 'S', values: [1, 2] }] })

  function blockTypes(editor: Editor): string[] {
    const names: string[] = []
    editor.state.doc.forEach(root => { names.push(root.firstChild?.type.name ?? '') })
    return names
  }

  it('粘贴 HTML 中合法的 linnya-chart 代码块成为图表块', () => {
    const editor = createEditor()
    editor.commands.setContent(`<div data-root-block><pre><code class="language-linnya-chart">${validJson}</code></pre></div>`)

    expect(blockTypes(editor)).toEqual(['chartBlock'])
    expect(editor.state.doc.firstChild?.firstChild?.attrs['spec']).toMatchObject({ chartType: 'bar' })
  })

  it('直接解析非法的专属围栏不会静默降级', () => {
    const editor = createEditor()
    const before = editor.state.doc
    expect(() => editor.commands.setContent('<pre><code class="language-linnya-chart">{"chartType":"bar"}</code></pre>')).toThrow('Invalid linnya-chart')
    expect(editor.state.doc).toBe(before)
  })

  it('普通语言（含 chart / echarts）的代码块保持不变', () => {
    const editor = createEditor()
    for (const language of ['chart', 'echarts', 'typescript']) {
      editor.commands.setContent(`<div data-root-block><pre><code class="language-${language}">x</code></pre></div>`)
      expect(editor.state.doc.firstChild?.firstChild?.attrs['language']).toBe(language)
    }
  })

  it('输入 ```linnya-chart 加空格会开始一张示例图表而不是代码块', () => {
    const editor = createEditor({
      type: 'doc',
      content: [{ type: 'rootBlock', attrs: { id: 'root-1' }, content: [{ type: 'baseBlock', attrs: { id: 'block-1' }, content: [{ type: 'text', text: '```linnya-chart' }] }] }],
    })
    editor.commands.focus('end')
    const { from, to } = editor.state.selection
    editor.view.someProp('handleTextInput', handler => handler(editor.view, from, to, ' ', () => editor.state.tr))

    expect(blockTypes(editor)).toContain('chartBlock')
    expect(blockTypes(editor)).not.toContain('codeBlock')
  })

  it('输入 ```json 加空格仍然是代码块', () => {
    const editor = createEditor({
      type: 'doc',
      content: [{ type: 'rootBlock', attrs: { id: 'root-1' }, content: [{ type: 'baseBlock', attrs: { id: 'block-1' }, content: [{ type: 'text', text: '```json' }] }] }],
    })
    editor.commands.focus('end')
    const { from, to } = editor.state.selection
    editor.view.someProp('handleTextInput', handler => handler(editor.view, from, to, ' ', () => editor.state.tr))

    expect(blockTypes(editor)).toEqual(['codeBlock'])
    expect(editor.state.doc.firstChild?.firstChild?.attrs['language']).toBe('json')
  })
})

describe('命令', () => {
  it('convertToChartBlock 转换当前空块、补尾部空块，并登记打开编辑面板的请求', () => {
    const editor = createEditor()
    editor.commands.focus('start')

    expect(editor.commands.convertToChartBlock(spec(), { openEditor: true, sample: true })).toBe(true)

    const doc = editor.state.doc
    expect(doc.child(0).firstChild?.type.name).toBe('chartBlock')
    expect(doc.child(0).firstChild?.attrs['id']).toBe('block-1')
    expect(doc.lastChild?.firstChild?.type.name).toBe('baseBlock')
    expect(useChartEditingStore().pending).toEqual({
      editorSessionId: editor.storage.chartBlock.sessionId,
      blockId: 'block-1',
      isSample: true,
    })
  })

  it('can() 预检查不产生副作用', () => {
    const editor = createEditor()
    editor.commands.focus('start')

    expect(editor.can().convertToChartBlock(spec(), { openEditor: true })).toBe(true)

    expect(editor.state.doc.child(0).firstChild?.type.name).toBe('baseBlock')
    expect(useChartEditingStore().pending).toBeNull()
  })
})

describe('阅读状态的会话生命周期', () => {
  const hiddenSeriesState = { ...DEFAULT_CHART_READING_STATE, hiddenSeries: ['S'] }

  it('每个 Editor 实例有独立的会话身份', () => {
    const first = createEditor()
    const second = createEditor()

    expect(first.storage.chartBlock.sessionId).not.toBe(second.storage.chartBlock.sessionId)
  })

  it('删除图表块时释放它的阅读状态，其他块不受影响', () => {
    const editor = createEditor({
      type: 'doc',
      content: [
        { type: 'rootBlock', attrs: { id: 'root-a' }, content: [{ type: 'chartBlock', attrs: { id: 'chart-a', blockType: 'chart', spec: spec() } }] },
        { type: 'rootBlock', attrs: { id: 'root-b' }, content: [{ type: 'chartBlock', attrs: { id: 'chart-b', blockType: 'chart', spec: spec() } }] },
      ],
    })
    const store = useChartReadingStore()
    const sessionId = editor.storage.chartBlock.sessionId
    store.write({ editorSessionId: sessionId, blockId: 'chart-a', variant: 'document' }, hiddenSeriesState, 'test-spec')
    store.write({ editorSessionId: sessionId, blockId: 'chart-b', variant: 'document' }, hiddenSeriesState, 'test-spec')

    const firstRoot = editor.state.doc.child(0)
    editor.view.dispatch(editor.state.tr.delete(0, firstRoot.nodeSize))

    expect(store.read({ editorSessionId: sessionId, blockId: 'chart-a', variant: 'document' })).toBe(DEFAULT_CHART_READING_STATE)
    expect(store.read({ editorSessionId: sessionId, blockId: 'chart-b', variant: 'document' })).toBe(hiddenSeriesState)
  })

  it('修改规格不释放阅读状态', () => {
    const editor = createEditor(chartDoc('chart-a'))
    const store = useChartReadingStore()
    const key = { editorSessionId: editor.storage.chartBlock.sessionId, blockId: 'chart-a', variant: 'document' } as const
    store.write(key, hiddenSeriesState, 'test-spec')

    // NodeView 通过 updateAttributes 更新规格：属性改变不是删除，阅读状态保留。
    editor.view.dispatch(editor.state.tr.setNodeMarkup(1, undefined, { id: 'chart-a', blockType: 'chart', spec: spec(7) }))

    expect(store.read(key)).toBe(hiddenSeriesState)
  })

  it('关闭编辑器释放该会话的全部阅读状态，不影响其他会话', () => {
    const closing = createEditor(chartDoc('chart-a'))
    const surviving = createEditor(chartDoc('chart-a'))
    const store = useChartReadingStore()
    const closingKey = { editorSessionId: closing.storage.chartBlock.sessionId, blockId: 'chart-a', variant: 'document' } as const
    const survivingKey = { editorSessionId: surviving.storage.chartBlock.sessionId, blockId: 'chart-a', variant: 'document' } as const
    store.write(closingKey, hiddenSeriesState, 'test-spec')
    store.write(survivingKey, hiddenSeriesState, 'test-spec')

    closing.destroy()

    expect(store.read(closingKey)).toBe(DEFAULT_CHART_READING_STATE)
    expect(store.read(survivingKey)).toBe(hiddenSeriesState)
  })
})

describe('审计回归：粘贴、查找和长文档', () => {
  const invalidHtml = '<div data-root-block><p>前文</p></div><div data-root-block><pre><code class="language-linnya-chart">{bad}</code></pre></div>'
  it('HTML 粘贴取消不落地；明确选择普通代码才一次插入全部内容', async () => {
    const editor = createEditor()
    const before = editor.state.doc
    const event = { clipboardData: { getData: () => invalidHtml }, preventDefault: vi.fn() }
    pasteDecision.mockResolvedValueOnce('cancel')
    expect(handleChartHtmlPaste(editor.view, event)).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(editor.state.doc).toBe(before)
    pasteDecision.mockResolvedValueOnce('as-code')
    handleChartHtmlPaste(editor.view, event)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(editor.state.doc.textContent).toContain('前文')
    expect(editor.state.doc.textContent).toContain('{bad}')
    expect(editor.getJSON().content?.some(root => root.content?.[0]?.type === 'codeBlock')).toBe(true)
  })

  it('查找图表文字按整块命中；替换跳过图表并支持删除普通文字', () => {
    const editor = createEditor(chartDoc('chart-1'))
    editor.commands.insertContentAt(editor.state.doc.content.size - 2, '销量')
    const matches = findMatchesInDoc(editor.state.doc, '销量')
    expect(matches).toHaveLength(2)
    expect(matches[0]).toMatchObject({ from: 1, to: 2, replaceable: false })
    const store = { searchTerm: '', matchCase: false, wholeWord: false, useRegex: false }
    editor.view.updateState(editor.state.reconfigure({ plugins: [...editor.state.plugins, createFindReplacePlugin(store)] }))
    searchCommand('销量')(editor.state, editor.view.dispatch)
    expect(replaceCurrentCommand('改名')(editor.state, editor.view.dispatch)).toBe(false)
    expect(replaceAllCommand('')(editor.state, editor.view.dispatch)).toBe(true)
    expect(editor.state.doc.firstChild?.firstChild?.attrs['spec']).toEqual(spec())
    expect(editor.state.doc.lastChild?.textContent).toBe('')
  })

  it('1600 块文档首次测量前，图表预留正确量级的空间且不污染正文均值', () => {
    const editor = createEditor(chartDoc('chart-1'))
    const schema = editor.schema
    const chart = editor.state.doc.firstChild
    if (!chart) throw new Error('missing fixture')
    const roots = Array.from({ length: 1600 }, (_, index) => index % 100 === 0
      ? chart.type.create({ id: `r-${index}` }, chart.content)
      : schema.nodes['rootBlock']!.create({ id: `r-${index}` }, schema.nodes['baseBlock']!.create({ id: `b-${index}` })))
    const doc = schema.nodes['doc']!.create(null, roots)
    syncRenderVirtualizationHeightEstimates(doc, editor)
    expect(getRenderVirtualizationBlockHeight('r-1500', editor)).toBeGreaterThanOrEqual(320)
    expect(getRenderVirtualizationBlockHeight('r-1501', editor)).toBe(120)
    expect(getRenderVirtualizationBlockHeightCacheSnapshot(editor).measuredCount).toBe(0)
  })
})
