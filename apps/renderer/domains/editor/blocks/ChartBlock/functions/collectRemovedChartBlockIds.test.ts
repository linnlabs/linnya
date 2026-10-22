import { describe, expect, it } from 'vitest'
import { EditorState, NodeSelection } from '@tiptap/pm/state'
import { admitMarkdownChartSpec } from '@app/schemas'
import { workspaceMarkdownSchemaLite as schema } from 'src/domains/markdown'
import { collectRemovedChartBlockIds } from './collectRemovedChartBlockIds'

function chartSpec() {
  const admission = admitMarkdownChartSpec({
    chartType: 'bar',
    categories: ['A', 'B'],
    series: [{ name: 'S', values: [1, 2] }],
  })
  if (!admission.ok) throw new Error('fixture invalid')
  return admission.spec
}

function root(id: string, inner: ReturnType<typeof schema.node>) {
  return schema.nodes['rootBlock']!.create({ id }, inner)
}

function chart(id: string) {
  return schema.nodes['chartBlock']!.create({ id, spec: chartSpec() })
}

function paragraph(id: string, text = '') {
  return schema.nodes['baseBlock']!.create({ id }, text ? schema.text(text) : undefined)
}

function stateOf(...roots: ReturnType<typeof root>[]) {
  return EditorState.create({ doc: schema.nodes['doc']!.create(null, roots) })
}

function positionOfRoot(state: EditorState, index: number): number {
  let pos = 0
  for (let i = 0; i < index; i += 1) pos += state.doc.child(i).nodeSize
  return pos
}

describe('collectRemovedChartBlockIds', () => {
  it('删除包含图表的 rootBlock 时返回该图表 id', () => {
    const state = stateOf(root('r1', paragraph('p1', 'hi')), root('r2', chart('chart-a')), root('r3', paragraph('p3')))
    const from = positionOfRoot(state, 1)
    const tr = state.tr.delete(from, from + state.doc.child(1).nodeSize)

    expect(collectRemovedChartBlockIds(tr)).toEqual(['chart-a'])
  })

  it('一次删除多个块时返回其中全部图表，不含正文块', () => {
    const state = stateOf(root('r1', chart('chart-a')), root('r2', paragraph('p2')), root('r3', chart('chart-b')))
    const tr = state.tr.delete(0, state.doc.content.size)

    expect([...collectRemovedChartBlockIds(tr)].sort()).toEqual(['chart-a', 'chart-b'])
  })

  it('修改规格（setNodeMarkup）不算删除', () => {
    const state = stateOf(root('r1', chart('chart-a')))
    const tr = state.tr.setNodeMarkup(1, null, { id: 'chart-a', blockType: 'chart', spec: chartSpec() })

    expect(collectRemovedChartBlockIds(tr)).toEqual([])
  })

  it('同一事务中把图表移动到别处不算删除', () => {
    const state = stateOf(root('r1', chart('chart-a')), root('r2', paragraph('p2')))
    const moving = state.doc.child(0)
    const tr = state.tr.delete(0, moving.nodeSize)
    tr.insert(tr.doc.content.size, moving)

    expect(collectRemovedChartBlockIds(tr)).toEqual([])
  })

  it('只改正文的事务没有删除', () => {
    const state = stateOf(root('r1', paragraph('p1', 'abc')), root('r2', chart('chart-a')))
    const tr = state.tr.insertText('x', 2)

    expect(collectRemovedChartBlockIds(tr)).toEqual([])
  })

  it('文档整体替换时，新内容里仍存在的图表不被释放', () => {
    const state = stateOf(root('r1', chart('chart-a')), root('r2', chart('chart-b')))
    const replacement = schema.nodes['doc']!.create(null, [root('r9', chart('chart-b'))])
    const tr = state.tr.replaceWith(0, state.doc.content.size, replacement.content)

    expect(collectRemovedChartBlockIds(tr)).toEqual(['chart-a'])
  })

  it('选中图表后删除选区同样识别', () => {
    const state = stateOf(root('r1', chart('chart-a')), root('r2', paragraph('p2')))
    const selected = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 1)))
    const tr = selected.tr.deleteSelection()

    expect(collectRemovedChartBlockIds(tr)).toEqual(['chart-a'])
  })
})

it('同一事务改属性后再删除时，清理最终不存在的图表', () => {
  const state = stateOf(root('r1', chart('chart-a')), root('r2', paragraph('p2')))
  const tr = state.tr.setNodeMarkup(1, null, { id: 'chart-a', spec: chartSpec() })
  tr.delete(0, tr.doc.child(0).nodeSize)
  expect(collectRemovedChartBlockIds(tr)).toEqual(['chart-a'])
})
