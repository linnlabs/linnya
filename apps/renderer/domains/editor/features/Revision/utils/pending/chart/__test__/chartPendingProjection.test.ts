import { describe, expect, it } from 'vitest'
import { applyChartPendingPlanToTr } from '../chartPendingProjection'
import { chartRoot, chartSpec, paragraphRoot, stateOf } from './chartPendingFixtures'

describe('applyChartPendingPlanToTr', () => {
  it('insert：空占位块变成图表，只计新增', () => {
    const state = stateOf(paragraphRoot('r1'))
    const tr = state.tr

    const result = applyChartPendingPlanToTr(tr, 0, { kind: 'put', spec: chartSpec(5) })

    expect(result).toEqual({ success: true, diffStats: { insertCount: 1, deleteCount: 0 } })
    const content = tr.doc.firstChild!.firstChild!
    expect(content.type.name).toBe('chartBlock')
    expect(content.attrs['spec']).toEqual(chartSpec(5))
    expect(content.attrs['id']).toBe('r1-content')
    expect(tr.doc.firstChild!.attrs['id']).toBe('r1')
  })

  it('update：有文字的段落换成图表，同时计新增和删除', () => {
    const state = stateOf(paragraphRoot('r1', '原文'))
    const tr = state.tr

    const result = applyChartPendingPlanToTr(tr, 0, { kind: 'put', spec: chartSpec() })

    expect(result).toEqual({ success: true, diffStats: { insertCount: 1, deleteCount: 1 } })
    expect(tr.doc.firstChild!.firstChild!.type.name).toBe('chartBlock')
  })

  it('update：图表换成另一份规格，保留块 id', () => {
    const state = stateOf(chartRoot('r1', chartSpec(1)))
    const tr = state.tr

    const result = applyChartPendingPlanToTr(tr, 0, { kind: 'put', spec: chartSpec(9) })

    expect(result).toEqual({ success: true, diffStats: { insertCount: 1, deleteCount: 1 } })
    const content = tr.doc.firstChild!.firstChild!
    expect(content.attrs['spec']).toEqual(chartSpec(9))
    expect(content.attrs['id']).toBe('r1-chart')
  })

  it('update：规格没有变化时文档不动，也不产生统计', () => {
    const state = stateOf(chartRoot('r1', chartSpec(1)))
    const tr = state.tr

    const result = applyChartPendingPlanToTr(tr, 0, { kind: 'put', spec: chartSpec(1) })

    expect(result.success).toBe(true)
    expect(result.diffStats).toEqual({ insertCount: 0, deleteCount: 0 })
    expect(tr.docChanged).toBe(false)
  })

  it('remove：文档不变，登记一次整图删除', () => {
    const state = stateOf(chartRoot('r1'))
    const tr = state.tr

    const result = applyChartPendingPlanToTr(tr, 0, { kind: 'remove' })

    expect(result).toEqual({ success: true, diffStats: { insertCount: 0, deleteCount: 1 } })
    expect(tr.docChanged).toBe(false)
  })

  it('invalid：失败并带原因，文档不变', () => {
    const state = stateOf(paragraphRoot('r1', 'x'))
    const tr = state.tr

    const result = applyChartPendingPlanToTr(tr, 0, { kind: 'invalid', reason: 'bad spec' })

    expect(result).toEqual({ success: false, reason: 'bad spec' })
    expect(tr.docChanged).toBe(false)
  })

  it('目标位置不是 rootBlock 时失败而不是写坏文档', () => {
    const state = stateOf(paragraphRoot('r1', 'x'))
    const tr = state.tr

    expect(applyChartPendingPlanToTr(tr, 1, { kind: 'put', spec: chartSpec() }).success).toBe(false)
    expect(tr.docChanged).toBe(false)
  })

  it('产物是合法文档', () => {
    const state = stateOf(paragraphRoot('r1', 'x'), chartRoot('r2'))
    const tr = state.tr
    applyChartPendingPlanToTr(tr, 0, { kind: 'put', spec: chartSpec(4) })

    expect(() => tr.doc.check()).not.toThrow()
  })
})
