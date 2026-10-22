import { describe, expect, it } from 'vitest'
import { admitMarkdownChartSpec } from '@app/schemas'
import { deriveChartRevisionView, type ChartRevisionViewInput } from './chartRevisionView'

const admission = admitMarkdownChartSpec({ chartType: 'bar', categories: ['A'], series: [{ name: 'S', values: [1] }] })
if (!admission.ok) throw new Error('fixture invalid')
const baselineSpec = admission.spec

const base: ChartRevisionViewInput = {
  operation: null,
  projection: null,
  baselineAvailable: false,
  baselineSpec: null,
  showingBaseline: false,
}

describe('deriveChartRevisionView', () => {
  it('没有修订：正常显示，可编辑，使用正文阅读状态', () => {
    expect(deriveChartRevisionView(base)).toMatchObject({
      pending: false, badge: null, canToggleBaseline: false, editable: true, readingVariant: 'document',
    })
  })

  it('insert 已投影：提议标记，不能对照原内容（原块只是空占位），不可编辑', () => {
    const view = deriveChartRevisionView({ ...base, operation: 'insert', projection: 'ready', baselineAvailable: true })

    expect(view).toMatchObject({ pending: true, badge: 'proposed', canToggleBaseline: false, editable: false, readingVariant: 'proposed' })
  })

  it('update 已投影：默认看提议，可以切换到原图表，阅读状态按用途隔离', () => {
    const input: ChartRevisionViewInput = { ...base, operation: 'update', projection: 'ready', baselineAvailable: true, baselineSpec }

    expect(deriveChartRevisionView(input)).toMatchObject({
      badge: 'proposed', canToggleBaseline: true, displaysBaseline: false, readingVariant: 'proposed',
    })
    expect(deriveChartRevisionView({ ...input, showingBaseline: true })).toMatchObject({
      displaysBaseline: true, showBaselineNote: false, readingVariant: 'baseline', editable: false,
    })
  })

  it('update 的原内容不是图表：切换后给出说明而不是伪造一张图', () => {
    const view = deriveChartRevisionView({
      ...base, operation: 'update', projection: 'ready', baselineAvailable: true, baselineSpec: null, showingBaseline: true,
    })

    expect(view).toMatchObject({ canToggleBaseline: true, displaysBaseline: false, showBaselineNote: true, readingVariant: 'proposed' })
  })

  it('update 但账本没有原块：不提供对照', () => {
    const view = deriveChartRevisionView({ ...base, operation: 'update', projection: 'ready', baselineAvailable: false, showingBaseline: true })

    expect(view).toMatchObject({ canToggleBaseline: false, displaysBaseline: false, showBaselineNote: false })
  })

  it('delete：块里仍是现有图表，标注“待确认删除”，沿用正文阅读状态', () => {
    const view = deriveChartRevisionView({ ...base, operation: 'delete', projection: 'ready' })

    expect(view).toMatchObject({ pending: true, badge: 'deleted', canToggleBaseline: false, editable: false, readingVariant: 'document' })
  })

  it('尚未投影或投影失败：不打提议标记（块内仍是原内容），但仍不可编辑', () => {
    for (const projection of ['deferred', 'failed'] as const) {
      const view = deriveChartRevisionView({ ...base, operation: 'update', projection, baselineAvailable: true, baselineSpec })
      expect(view).toMatchObject({ pending: true, badge: null, canToggleBaseline: false, editable: false, readingVariant: 'document' })
    }
  })
})
