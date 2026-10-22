// @vitest-environment jsdom
import { Editor, Node } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import StarterKit from '@tiptap/starter-kit'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ startRevision: vi.fn() }))

vi.mock('@tiptap/vue-3', () => ({ VueNodeViewRenderer: vi.fn(() => vi.fn()) }))
vi.mock('../../../../../../blocks/ChartBlock/ui/ChartBlockView.vue', () => ({ default: {} }))
vi.mock('../../../../useRevisionStore', () => ({ useRevisionStore: () => ({ startRevision: mocks.startRevision }) }))

import { BaseBlock } from '../../../../../../blocks/BaseBlock'
import { ChartBlock } from '../../../../../../blocks/ChartBlock/ChartBlock'
import { applyChartPendingItems } from '../chartPendingRevisionApplier'
import { chartSpec, pending } from './chartPendingFixtures'

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

const editors: Editor[] = []

function createEditor() {
  const editor = new Editor({
    extensions: [
      Document.extend({ content: 'rootBlock+' }),
      StarterKit.configure({ document: false, trailingNode: false }),
      TestRootBlock,
      BaseBlock,
      ChartBlock,
    ],
    content: {
      type: 'doc',
      content: [
        { type: 'rootBlock', attrs: { id: 'root-empty' }, content: [{ type: 'baseBlock', attrs: { id: 'b1' } }] },
        { type: 'rootBlock', attrs: { id: 'root-text' }, content: [{ type: 'baseBlock', attrs: { id: 'b2' }, content: [{ type: 'text', text: '原文' }] }] },
        { type: 'rootBlock', attrs: { id: 'root-chart' }, content: [{ type: 'chartBlock', attrs: { id: 'c1', blockType: 'chart', spec: chartSpec(1) } }] },
      ],
    },
  })
  editors.push(editor)
  return editor
}

beforeEach(() => {
  setActivePinia(createPinia())
  mocks.startRevision.mockReset()
})
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()))

describe('applyChartPendingItems', () => {
  it('一批图表计划只派发一个投影事务，并按各自增删统计登记', () => {
    const editor = createEditor()
    const dispatch = vi.spyOn(editor.view, 'dispatch')

    const results = applyChartPendingItems(editor, [
      { parsed: pending({ id: 'a-1', blockId: 'root-empty', operation: 'insert', createdAt: 11 }), plan: { kind: 'put', spec: chartSpec(2) } },
      { parsed: pending({ id: 'b-1', blockId: 'root-text', operation: 'update' }), plan: { kind: 'put', spec: chartSpec(3) } },
      { parsed: pending({ id: 'c-1', blockId: 'root-chart', operation: 'delete' }), plan: { kind: 'remove' } },
    ])

    expect(results.map(result => [result.id, result.success])).toEqual([['a-1', true], ['b-1', true], ['c-1', true]])
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch.mock.calls[0]![0].getMeta('pendingRevisionApply')).toBe(true)

    const kinds: string[] = []
    editor.state.doc.forEach(root => kinds.push(root.firstChild!.type.name))
    expect(kinds).toEqual(['chartBlock', 'chartBlock', 'chartBlock'])

    expect(mocks.startRevision.mock.calls.map(call => call[0])).toEqual([
      { blockId: 'root-empty', revisionId: 'ai-a-1', operation: 'insert', diffStats: { insertCount: 1, deleteCount: 0 }, createdAt: 11 },
      { blockId: 'root-text', revisionId: 'ai-b-1', operation: 'update', diffStats: { insertCount: 1, deleteCount: 1 }, createdAt: undefined },
      { blockId: 'root-chart', revisionId: 'ai-c-1', operation: 'delete', diffStats: { insertCount: 0, deleteCount: 1 }, createdAt: undefined },
    ])
  })

  it('失败只影响该条：缺少目标块或计划无效不阻断同批其他块', () => {
    const editor = createEditor()

    const results = applyChartPendingItems(editor, [
      { parsed: pending({ id: 'x-1', blockId: 'missing', operation: 'update' }), plan: { kind: 'put', spec: chartSpec() } },
      { parsed: pending({ id: 'x-2', blockId: 'root-text', operation: 'update' }), plan: { kind: 'invalid', reason: 'bad spec' } },
      { parsed: pending({ id: 'x-3', blockId: 'root-empty', operation: 'insert' }), plan: { kind: 'put', spec: chartSpec() } },
    ])

    expect(results.map(result => result.success)).toEqual([false, false, true])
    expect(results[0]!.reason).toContain('missing')
    expect(results[1]!.reason).toBe('bad spec')
    expect(mocks.startRevision).toHaveBeenCalledTimes(1)
    expect(mocks.startRevision.mock.calls[0]![0].blockId).toBe('root-empty')
  })

  it('规格无变化时成功但不登记修订、不改文档', () => {
    const editor = createEditor()
    const before = editor.state.doc

    const results = applyChartPendingItems(editor, [
      { parsed: pending({ id: 's-1', blockId: 'root-chart', operation: 'update' }), plan: { kind: 'put', spec: chartSpec(1) } },
    ])

    expect(results[0]).toMatchObject({ success: true })
    expect(editor.state.doc.eq(before)).toBe(true)
    expect(mocks.startRevision).not.toHaveBeenCalled()
  })

  it('没有图表计划时什么都不做', () => {
    const editor = createEditor()
    const dispatch = vi.spyOn(editor.view, 'dispatch')

    expect(applyChartPendingItems(editor, [])).toEqual([])
    expect(dispatch).not.toHaveBeenCalled()
  })
})
