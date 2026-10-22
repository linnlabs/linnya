import { describe, expect, it } from 'vitest'
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state'
import { admitMarkdownChartSpec } from '@app/schemas'
import { workspaceMarkdownSchemaLite as schema } from 'src/domains/markdown'
import { buildConvertToChartTransaction } from './chartBlockTransactions'

function fixtureSpec(value = 1) {
  const admission = admitMarkdownChartSpec({
    chartType: 'bar',
    categories: ['A', 'B'],
    series: [{ name: 'S', values: [value, 2] }],
  })
  if (!admission.ok) throw new Error('fixture invalid')
  return admission.spec
}

function docOf(...roots: ReturnType<typeof schema.node>[]) {
  return schema.nodes['doc']!.create(null, roots)
}

function paragraphRoot(rootId: string, blockId: string, text = '') {
  return schema.nodes['rootBlock']!.create(
    { id: rootId },
    schema.nodes['baseBlock']!.create({ id: blockId }, text ? schema.text(text) : undefined),
  )
}

function stateAt(doc: ReturnType<typeof docOf>, cursorPos: number) {
  return EditorState.create({ doc, selection: TextSelection.near(doc.resolve(cursorPos)) })
}

describe('buildConvertToChartTransaction', () => {
  it('把光标所在的空段落转成图表，保留 rootBlock 与内容块 id', () => {
    const doc = docOf(paragraphRoot('root-1', 'block-1'), paragraphRoot('root-2', 'block-2', 'tail'))
    const result = buildConvertToChartTransaction(stateAt(doc, 2), fixtureSpec())
    if (result.kind !== 'converted') throw new Error(`unexpected ${result.kind}`)

    const next = result.transaction.doc
    expect(next.child(0).attrs['id']).toBe('root-1')
    const chart = next.child(0).firstChild!
    expect(chart.type.name).toBe('chartBlock')
    expect(chart.attrs['id']).toBe('block-1')
    expect(result.chartId).toBe('block-1')
    expect(next.childCount).toBe(2)
  })

  it('图表后面是文档末尾时补一个空段落，且图表被选中', () => {
    const doc = docOf(paragraphRoot('root-1', 'block-1'))
    const result = buildConvertToChartTransaction(stateAt(doc, 2), fixtureSpec(), {
      trailingRootId: 'trailing-root',
      trailingBlockId: 'trailing-block',
    })
    if (result.kind !== 'converted') throw new Error(`unexpected ${result.kind}`)

    const next = result.transaction.doc
    expect(next.childCount).toBe(2)
    expect(next.child(1).attrs['id']).toBe('trailing-root')
    expect(next.child(1).firstChild!.type.name).toBe('baseBlock')
    expect(next.child(1).firstChild!.attrs['id']).toBe('trailing-block')
    const selection = result.transaction.selection
    expect(selection).toBeInstanceOf(NodeSelection)
    expect((selection as NodeSelection).node.type.name).toBe('chartBlock')
  })

  it('不在文档末尾时不额外补段落', () => {
    const doc = docOf(paragraphRoot('root-1', 'block-1'), paragraphRoot('root-2', 'block-2', 'tail'))
    const result = buildConvertToChartTransaction(stateAt(doc, 2), fixtureSpec())
    if (result.kind !== 'converted') throw new Error(`unexpected ${result.kind}`)

    expect(result.transaction.doc.childCount).toBe(2)
  })

  it('表格内拒绝转换', () => {
    const cell = schema.nodes['tableCell']!.create(null, schema.nodes['tableCellContentBlock']!.create({ id: 'cell-block' }))
    const row = schema.nodes['tableRow']!.create(null, cell)
    const table = schema.nodes['table']!.create({ id: 'table-1' }, row)
    const doc = docOf(schema.nodes['rootBlock']!.create({ id: 'root-1' }, table))
    // 找到单元格内的文本位置
    let cursorPos = -1
    doc.descendants((node, pos) => {
      if (node.type.name === 'tableCellContentBlock') cursorPos = pos + 1
      return true
    })
    expect(cursorPos).toBeGreaterThan(0)

    expect(buildConvertToChartTransaction(stateAt(doc, cursorPos), fixtureSpec())).toEqual({ kind: 'in-table' })
  })

  it('转换产物是合法文档（节点属性与内容规则都通过 check）', () => {
    const doc = docOf(paragraphRoot('root-1', 'block-1'))
    const result = buildConvertToChartTransaction(stateAt(doc, 2), fixtureSpec())
    if (result.kind !== 'converted') throw new Error(`unexpected ${result.kind}`)

    expect(() => result.transaction.doc.check()).not.toThrow()
  })
})
