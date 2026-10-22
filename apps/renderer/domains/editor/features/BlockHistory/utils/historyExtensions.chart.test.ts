// @vitest-environment jsdom
import { Editor } from '@tiptap/core'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { admitMarkdownChartSpec } from '@app/schemas'

vi.mock('@tiptap/vue-3', async () => ({
  ...(await vi.importActual<typeof import('@tiptap/vue-3')>('@tiptap/vue-3')),
  VueNodeViewRenderer: vi.fn(() => vi.fn()),
}))
vi.mock('../../../blocks/ChartBlock/ui/ChartReadonlyView.vue', () => ({ default: {} }))
vi.mock('../../../blocks/CodeBlock/ui/CodeBlockView.vue', () => ({ default: {} }))

import { parseEditorDocumentJson } from '../../../functions/parseEditorDocumentJson'
import { buildHistoryVersionDocument } from '../functions/buildHistoryVersionDocument'
import { createHistoryEditorOptions } from './createHistoryEditor'

const admission = admitMarkdownChartSpec({
  chartType: 'line',
  title: '历史版本里的图表',
  categories: ['Q1', 'Q2'],
  series: [{ name: '营收', values: [1, 2] }],
})
if (!admission.ok) throw new Error('fixture invalid')

const snapshot = JSON.stringify({
  type: 'rootBlock',
  attrs: { id: 'root-1' },
  content: [{ type: 'chartBlock', attrs: { id: 'chart-1', blockType: 'chart', spec: admission.spec } }],
})

const editors: Editor[] = []
beforeEach(() => setActivePinia(createPinia()))
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()))

describe('块历史视图中的图表快照', () => {
  it('图表版本可以按历史 Editor 的严格 schema 解析并显示（不再是空白）', () => {
    const editor = new Editor(createHistoryEditorOptions())
    editors.push(editor)
    const document = buildHistoryVersionDocument(snapshot)

    const parsed = parseEditorDocumentJson(document, editor.schema)
    editor.commands.setContent(document, { emitUpdate: false, errorOnInvalidContent: true })

    expect(parsed.firstChild?.firstChild?.type.name).toBe('chartBlock')
    expect(editor.state.doc.firstChild?.firstChild?.attrs['spec']).toEqual(admission.spec)
    expect(editor.isEditable).toBe(false)
  })

  it('历史视图不带编辑命令：只读场景无法修改图表', () => {
    const editor = new Editor(createHistoryEditorOptions())
    editors.push(editor)

    expect('convertToChartBlock' in editor.commands).toBe(false)
    expect('convertToSampleChart' in editor.commands).toBe(false)
  })

  it('缺少规格的快照仍被严格拒绝，不会静默渲染成别的内容', () => {
    const editor = new Editor(createHistoryEditorOptions())
    editors.push(editor)
    const broken = buildHistoryVersionDocument(JSON.stringify({
      type: 'rootBlock',
      attrs: { id: 'root-1' },
      content: [{ type: 'chartBlock', attrs: { id: 'chart-1', blockType: 'chart' } }],
    }))

    expect(() => parseEditorDocumentJson(broken, editor.schema)).toThrow()
  })
})
